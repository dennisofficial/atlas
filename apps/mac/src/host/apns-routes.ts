import { EMacPush, groupsToRemove, macPushOf } from '@dltech/atlas-notifications/client'
import { z } from 'zod'

export const APNS_TOKEN_PATH = '/desktop/apns/token'

export const APNS_PUSH_PATH = '/desktop/apns/push'

const tokenBodySchema = z.object({ token: z.string().min(1).max(4096) })

const pushBodySchema = z.object({
  userInfo: z.unknown(),
  groupIds: z.array(z.string().min(1)).max(200),
})

export type ApnsRouteHandler = (request: Request, pathname: string) => Promise<Response | undefined>

export type ApnsRoutes = {
  handler: ApnsRouteHandler
  sync: () => Promise<void>
}

export function createApnsRoutes({
  register,
  signedIn,
  save,
}: {
  register: (input: { token: string }) => Promise<void>
  signedIn: () => boolean
  save?: ((token: string) => void) | undefined
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

  const handler: ApnsRouteHandler = async (request, pathname) => {
    if (pathname !== APNS_TOKEN_PATH && pathname !== APNS_PUSH_PATH) return undefined
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    const body: unknown = await request.json().catch(() => undefined)
    if (pathname === APNS_PUSH_PATH) {
      const parsed = pushBodySchema.safeParse(body)
      if (!parsed.success) return new Response('Bad Request', { status: 400 })
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
