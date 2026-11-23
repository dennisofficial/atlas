import { ENotifyDeviceKind, ENotifyTrackEvent } from '@dltech/atlas-core'
import { macPushOf, groupsToRemove, EMacPush } from '@dltech/atlas-notifications/client'
import type { TrackNotificationInput } from '@dltech/atlas-wire'
import { z } from 'zod'

export const APNS_TOKEN_PATH = '/desktop/apns/token'

export const APNS_PUSH_PATH = '/desktop/apns/push'

export const APNS_OPENED_PATH = '/desktop/apns/opened'

const tokenBodySchema = z.object({ token: z.string().min(1).max(4096) })

const pushBodySchema = z.object({
  userInfo: z.unknown(),
  groupIds: z.array(z.string().min(1)).max(200),
})

const openedBodySchema = z.object({ userInfo: z.unknown() })

export type ApnsRouteHandler = (request: Request, pathname: string) => Promise<Response | undefined>

export type ApnsTrack = (input: TrackNotificationInput) => Promise<void>

export type ApnsRoutes = {
  handler: ApnsRouteHandler
  sync: () => Promise<void>
}

const deliveredOf = (userInfo: unknown): TrackNotificationInput | null => {
  const push = macPushOf(userInfo)
  if (push?.kind !== EMacPush.Notification || push.moment === undefined) return null
  return {
    event: ENotifyTrackEvent.Delivered,
    sessionId: push.sessionId,
    seq: push.seq,
    moment: push.moment,
    deviceKind: ENotifyDeviceKind.ApnsMac,
    ...(push.sentAt === undefined ? {} : { sentAt: push.sentAt }),
  }
}

const openedOf = (userInfo: unknown): TrackNotificationInput | null => {
  const push = macPushOf(userInfo)
  if (push?.kind !== EMacPush.Notification || push.moment === undefined) return null
  return {
    event: ENotifyTrackEvent.Opened,
    sessionId: push.sessionId,
    seq: push.seq,
    moment: push.moment,
    deviceKind: ENotifyDeviceKind.ApnsMac,
    ...(push.sentAt === undefined ? {} : { sentAt: push.sentAt }),
  }
}

export function createApnsRoutes({
  register,
  signedIn,
  save,
  track,
}: {
  register: (input: { token: string }) => Promise<void>
  signedIn: () => boolean
  save?: ((token: string) => void) | undefined
  track?: ApnsTrack | undefined
}): ApnsRoutes {
  let token: string | undefined
  let registeredFor: string | undefined

  const sync = async (): Promise<void> => {
    if (!signedIn()) {
      registeredFor = undefined
      return
    }
    if (token === undefined || registeredFor === token) return
    registeredFor = token
    try {
      await register({ token })
    } catch {
      registeredFor = undefined
    }
  }

  const groupsIn = (body: z.infer<typeof pushBodySchema>): string[] => {
    const push = macPushOf(body.userInfo)
    if (push?.kind !== EMacPush.Clear) return []
    const history = body.groupIds.map((groupId) => ({ groupId }))
    return groupsToRemove({ history, sessionId: push.sessionId })
  }

  const report = async (input: TrackNotificationInput | null): Promise<void> => {
    if (input === null || track === undefined) return
    await track(input).catch(() => undefined)
  }

  const handler: ApnsRouteHandler = async (request, pathname) => {
    if (
      pathname !== APNS_TOKEN_PATH &&
      pathname !== APNS_PUSH_PATH &&
      pathname !== APNS_OPENED_PATH
    )
      return undefined
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    const body: unknown = await request.json().catch(() => undefined)
    if (pathname === APNS_OPENED_PATH) {
      const parsed = openedBodySchema.safeParse(body)
      if (!parsed.success) return new Response('Bad Request', { status: 400 })
      await report(openedOf(parsed.data.userInfo))
      return Response.json({ ok: true })
    }
    if (pathname === APNS_PUSH_PATH) {
      const parsed = pushBodySchema.safeParse(body)
      if (!parsed.success) return new Response('Bad Request', { status: 400 })
      await report(deliveredOf(parsed.data.userInfo))
      return Response.json({ groups: groupsIn(parsed.data) })
    }
    const parsed = tokenBodySchema.safeParse(body)
    if (!parsed.success) return new Response('Bad Request', { status: 400 })
    token = parsed.data.token
    save?.(token)
    await sync()
    return Response.json({ ok: true })
  }

  return { handler, sync }
}
