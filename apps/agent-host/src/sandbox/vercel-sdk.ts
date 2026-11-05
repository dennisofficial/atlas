import { Sandbox } from '@vercel/sandbox'

import { SANDBOX_QUICK_TIMEOUT_MS, SANDBOX_SERVE_PORT } from './constants'

const ROUTE_RETRY_ATTEMPTS = 3
const ROUTE_RETRY_DELAY_MS = 1_000

export type VercelSdk = {
  getOrCreate: (params: Parameters<typeof Sandbox.getOrCreate>[0]) => Promise<Sandbox>
  get: (params: Parameters<typeof Sandbox.get>[0]) => Promise<Sandbox>
}

const preconnectOf = (target: object): { preconnect?: unknown } =>
  'preconnect' in target ? { preconnect: target.preconnect } : {}

const gzipOnlyFetch = Object.assign(
  (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers)
    headers.set('accept-encoding', 'gzip, deflate')
    return fetch(input, { ...init, headers })
  },
  preconnectOf(fetch),
) as typeof fetch

export const liveSdk: VercelSdk = {
  getOrCreate: (params) => Sandbox.getOrCreate({ ...params, fetch: gzipOnlyFetch }),
  get: (params) => Sandbox.get({ ...params, fetch: gzipOnlyFetch }),
}

const routedUrlOf = (sandbox: Sandbox): string | undefined => {
  try {
    return sandbox.domain(SANDBOX_SERVE_PORT)
  } catch {
    return undefined
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const routedUrlWithRetries = async (sandbox: Sandbox): Promise<string> => {
  for (let attempt = 1; attempt <= ROUTE_RETRY_ATTEMPTS; attempt += 1) {
    const url = routedUrlOf(sandbox)
    if (url !== undefined) return url
    if (attempt < ROUTE_RETRY_ATTEMPTS) await sleep(ROUTE_RETRY_DELAY_MS)
  }
  throw new Error(
    `sandbox ${sandbox.name} has no route for port ${SANDBOX_SERVE_PORT} after ${ROUTE_RETRY_ATTEMPTS} attempts`,
  )
}

export const renewSessionDeadline = async (args: {
  sandbox: Sandbox
  name: string
  sessionId: string
  until: number
}): Promise<void> => {
  const session = args.sandbox.currentSession()
  if (session.status !== 'running')
    throw new Error(
      `refusing to renew sandbox ${args.name}: session ${args.sessionId} is ${session.status}`,
    )
  const before = args.sandbox.expiresAt?.getTime()
  const extendedByMs = before === undefined ? 0 : Math.max(0, Math.ceil(args.until - before))
  if (extendedByMs > 0)
    await session.extendTimeout(extendedByMs, {
      signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
    })
}
