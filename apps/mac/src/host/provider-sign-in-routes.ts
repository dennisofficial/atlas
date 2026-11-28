import {
  startProviderLoopback,
  type ProviderLoopback,
  type ProviderSignInLoopbackBegin,
} from '@dltech/atlas-client/loopback'
import { EAuthProvider } from '@dltech/atlas-core'
import { EOauthProvider } from '@dltech/atlas-wire'
import { z } from 'zod'

export enum EProviderHostState {
  Pending = 'pending',
  SignedIn = 'signed-in',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

type Status = { state: EProviderHostState; reason?: string }
type Attempt = { status: Status; loopback: ProviderLoopback }
export type ProviderSignInHandler = (
  request: Request,
  pathname: string,
) => Promise<Response | undefined>

const PREFIX = '/desktop/provider-sign-in'
const startSchema = z.object({
  provider: z.enum([EOauthProvider.Anthropic, EOauthProvider.OpenAI]),
})
const stopSchema = z.object({ attemptId: z.string().min(1) })
const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'The sign-in request failed'

export function createProviderSignInRoutes(args: {
  begin: (input: {
    provider: EOauthProvider
    redirectUri: string
  }) => Promise<ProviderSignInLoopbackBegin>
  complete: (input: { attemptId: string; code: string }) => Promise<unknown>
  open: (url: string) => unknown
}): { handler: ProviderSignInHandler; stop: () => void } {
  const attempts = new Map<string, Attempt>()
  let starting: AbortController | undefined

  const cancel = (attempt: Attempt): void => {
    if (attempt.status.state !== EProviderHostState.Pending) return
    attempt.status = { state: EProviderHostState.Cancelled }
    attempt.loopback.stop()
  }
  const stop = (): void => {
    starting?.abort()
    for (const attempt of attempts.values()) cancel(attempt)
  }
  const settle = async (attempt: Attempt): Promise<void> => {
    const returned = await attempt.loopback.outcome
    if (attempt.status.state !== EProviderHostState.Pending) return
    if (returned === undefined) {
      attempt.status = { state: EProviderHostState.Failed, reason: 'Sign-in timed out' }
      return
    }
    if ('error' in returned) {
      attempt.status = { state: EProviderHostState.Failed, reason: returned.error }
      return
    }
    try {
      await args.complete({ attemptId: attempt.loopback.attemptId, code: returned.code })
      if (attempt.status.state === EProviderHostState.Pending)
        attempt.status = { state: EProviderHostState.SignedIn }
    } catch (error) {
      if (attempt.status.state === EProviderHostState.Pending)
        attempt.status = { state: EProviderHostState.Failed, reason: reasonOf(error) }
    }
  }
  const start = async (request: Request): Promise<Response> => {
    const parsed = startSchema.safeParse(await request.json().catch(() => undefined))
    if (!parsed.success) return new Response('Bad Request', { status: 400 })
    if (
      starting !== undefined ||
      [...attempts.values()].some((a) => a.status.state === EProviderHostState.Pending)
    )
      return Response.json({ fallback: true, reason: 'A sign-in is already open' }, { status: 409 })
    const controller = new AbortController()
    starting = controller
    try {
      const provider = parsed.data.provider
      const loopback = await startProviderLoopback({
        provider:
          provider === EOauthProvider.Anthropic ? EAuthProvider.Anthropic : EAuthProvider.OpenAI,
        begin: ({ redirectUri }) => args.begin({ provider, redirectUri }),
        open: args.open,
        signal: controller.signal,
      })
      const attempt: Attempt = { loopback, status: { state: EProviderHostState.Pending } }
      if (attempts.size >= 32) {
        const oldest = attempts.keys().next().value
        if (oldest !== undefined) attempts.delete(oldest)
      }
      attempts.set(loopback.attemptId, attempt)
      void settle(attempt)
      return Response.json({ attemptId: loopback.attemptId })
    } catch (error) {
      return Response.json({ fallback: true, reason: reasonOf(error) }, { status: 502 })
    } finally {
      starting = undefined
    }
  }

  const handler: ProviderSignInHandler = async (request, pathname) => {
    if (pathname === `${PREFIX}/start` && request.method === 'POST') return start(request)
    if (pathname === `${PREFIX}/status` && request.method === 'GET') {
      const id = new URL(request.url).searchParams.get('attempt')
      const attempt = id === null ? undefined : attempts.get(id)
      return attempt === undefined
        ? new Response('Not Found', { status: 404 })
        : Response.json(attempt.status, { headers: { 'cache-control': 'no-store' } })
    }
    if (pathname === `${PREFIX}/stop` && request.method === 'POST') {
      const parsed = stopSchema.safeParse(await request.json().catch(() => undefined))
      if (!parsed.success) return new Response('Bad Request', { status: 400 })
      const attempt = attempts.get(parsed.data.attemptId)
      if (attempt !== undefined) cancel(attempt)
      return new Response(null, { status: 204 })
    }
    return undefined
  }
  return { handler, stop }
}
