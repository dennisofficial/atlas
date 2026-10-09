import { Sandbox } from '@vercel/sandbox'

import { DRIVE_WORKSPACE_PATH } from './sandbox-drive.js'

export type SandboxStateWire = 'running' | 'parked' | 'resuming' | 'stopped' | 'unknown'

export const SANDBOX_REGION = 'iad1'
export const SANDBOX_SERVE_PORT = 3000
/** The SDK's per-sandbox ceiling; the serve port occupies one slot. */
export const SANDBOX_MAX_PORTS = 15
/**
 * The workspace lives on the thread's drive, mounted at the sandbox root — the sandbox's own
 * filesystem holds only the image and whatever the session installs, and `persistent: true`
 * snapshots cover that OS layer between stops. The path is told to serve rather than inferred, so
 * both halves agree.
 */
export const WORKSPACE_PATH = DRIVE_WORKSPACE_PATH

/** Set once at creation and never extended: an idle sandbox parks itself. */
export const SANDBOX_TIMEOUT_MS = 4 * 60 * 60 * 1000

export const SANDBOX_LAUNCH_TIMEOUT_MS = 60_000
export const SANDBOX_QUICK_TIMEOUT_MS = 30_000
const ROUTE_RETRY_ATTEMPTS = 3
const ROUTE_RETRY_DELAY_MS = 1_000

export type VercelCredentials = { token: string; teamId: string; projectId: string }

export type VercelSandboxConfig = {
  credentials: VercelCredentials
  image: string
  /**
   * The serve version this build pins, from `sandboxImageOf` — a released Atlas names its own
   * version, anything else undefined. Drives the resume-time drift check: a sandbox whose baked
   * serve predates the pin is torn down and recreated from the pinned image rather than resumed
   * stale. Undefined disables the check (no pinned serve to match against).
   */
  serveVersion?: string | undefined
}

export type SandboxPlacement = {
  sessionId: string
  url: string
  state: SandboxStateWire
  /** True only when the SDK's `onCreate` hook fired: a genuinely new sandbox, not a resumed one. */
  created: boolean
  /** The drive the sandbox mounted, so the claim row can record it. */
  driveName: string
  /**
   * The serve token the sandbox runs with — minted on this machine unless the caller passed one in.
   * The bridge hands it to the attach so the channel and the sandbox agree without a control plane.
   */
  token: string
  /** The serve version the rotation replaced, set when build drift drove the recreate. */
  rotatedFrom?: string | undefined
  /** The wire protocol the sandbox's old serve spoke, set when the sandbox was rotated onto the pinned image. */
  rotatedProtocol?: number | undefined
}

export type SandboxObservation = {
  state: SandboxStateWire
  url?: string
  /** The Vercel session the sandbox currently runs as — the identity the serve's park guard holds. */
  sandboxSessionId?: string | undefined
}

/** The static SDK surface the driver uses, injectable so a spec never reaches Vercel. */
export type VercelSdk = {
  getOrCreate: (
    params: Parameters<typeof Sandbox.getOrCreate>[0],
  ) => Promise<Sandbox>
  get: (params: Parameters<typeof Sandbox.get>[0]) => Promise<Sandbox>
}

/**
 * Bun's fetch throws BrotliDecompressionError on Vercel's streamed cmd responses, so the driver
 * negotiates gzip — the one content-coding Bun decompresses reliably here.
 */
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

export const stateOf = (status: string): SandboxStateWire => {
  if (status === 'running') return 'running'
  if (status === 'pending') return 'resuming'
  if (status === 'stopped') return 'parked'
  if (status === 'failed' || status === 'aborted') return 'stopped'
  return 'unknown'
}

export const assertLiveSession = (args: {
  sandbox: Sandbox
  name: string
  expected: string | undefined
}): void => {
  const live = args.sandbox.currentSession().sessionId
  if (args.expected === undefined || live === args.expected) return
  throw new Error(
    `refusing to stop sandbox ${args.name}: its live session ${live} is not the session ${args.expected} this stop was issued for`,
  )
}

const sandboxSessionIdOf = (sandbox: Sandbox): string | undefined => {
  try {
    return sandbox.currentSession().sessionId
  } catch {
    return undefined
  }
}

export const routedUrlOf = (sandbox: Sandbox): string | undefined => {
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

export const observationOf = (sandbox: Sandbox): SandboxObservation => {
  const url = routedUrlOf(sandbox)
  const sandboxSessionId = sandboxSessionIdOf(sandbox)
  return {
    state: stateOf(sandbox.status),
    ...(sandboxSessionId === undefined ? {} : { sandboxSessionId }),
    ...(url === undefined ? {} : { url }),
  }
}
