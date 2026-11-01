import { Sandbox } from '@vercel/sandbox'
import type { SandboxDeadlineObservation } from './sandbox-self-wire.js'

import { SANDBOX_WORKSPACE_PATH } from './serve-env.js'

export type SandboxStateWire = 'running' | 'parked' | 'resuming' | 'stopped' | 'unknown'

export const SANDBOX_REGION = 'iad1'
export const SANDBOX_SERVE_PORT = 3000
/**
 * The workspace lives on the sandbox's own snapshot-persisted filesystem. The path is told to
 * serve rather than inferred, so both halves agree.
 */
export const WORKSPACE_PATH = SANDBOX_WORKSPACE_PATH

/** The boot deadline; serve renews it while work runs (`deadlineRenewal`) and parks when quiet. */
export const SANDBOX_TIMEOUT_MS = 4 * 60 * 60 * 1000

export const SANDBOX_SNAPSHOT_RETENTION = { count: 1, deleteEvicted: true } as const

export const SANDBOX_LAUNCH_TIMEOUT_MS = 60_000
export const SANDBOX_QUICK_TIMEOUT_MS = 30_000
const ROUTE_RETRY_ATTEMPTS = 3
const ROUTE_RETRY_DELAY_MS = 1_000

export type VercelCredentials = { token: string; teamId: string; projectId: string }

/** A linux-x64 serve built from a source checkout, pinned by `version` (`dev-<12 hex>`). */
export type DevServeBinary = {
  version: string
  path: string
  sha256: string
  bytes: number
}

export type DevServeResolver = (args: {
  log?: ((line: string) => void) | undefined
}) => Promise<DevServeBinary>

export type VercelSandboxConfig = {
  credentials: VercelCredentials
  image: string
  /**
   * Creation-time size for a fresh sandbox, from `sandbox.vcpus` — RAM rides along at 2048 MB
   * per vCPU. Vercel ignores create params when resuming, so this never resizes an existing
   * sandbox; /container resources is the live knob. Undefined leaves Vercel's own default.
   */
  vcpus?: number | undefined
  /**
   * The serve version this build pins, from `sandboxImageOf` — a released Atlas names its own
   * version, anything else undefined. Drives the resume-time drift check: a sandbox whose baked
   * serve predates the pin is torn down and recreated from the pinned image rather than resumed
   * stale. Undefined disables the check (no pinned serve to match against).
   */
  serveVersion?: string | undefined
  /**
   * Set only for a non-release build: resolved lazily on the first provision, its version becomes
   * the serve pin and its binary is uploaded instead of downloaded. Overrides `serveVersion`.
   */
  devServe?: DevServeResolver | undefined
}

export type SandboxPlacement = {
  sessionId: string
  url: string
  state: SandboxStateWire
  /** True only when the SDK's `onCreate` hook fired: a genuinely new sandbox, not a resumed one. */
  created: boolean
  /**
   * The serve token the sandbox runs with — minted on this machine unless the caller passed one in.
   * The bridge hands it to the attach so the channel and the sandbox agree without a control plane.
   */
  token: string
  /** The serve version the rotation replaced, set when build drift drove the recreate. */
  rotatedFrom?: string | undefined
  /** The wire protocol the sandbox's old serve spoke, set when the sandbox was rotated onto the pinned image. */
  rotatedProtocol?: number | undefined
  /** The serve pin this placement was provisioned against, a resolved dev pin included. */
  serveVersion?: string | undefined
}

export type SandboxObservation = {
  state: SandboxStateWire
  url?: string
  /** The Vercel session the sandbox currently runs as — the identity the serve's park guard holds. */
  sandboxSessionId?: string | undefined
}

/** The static SDK surface the driver uses, injectable so a spec never reaches Vercel. */
export type VercelSdk = {
  getOrCreate: (params: Parameters<typeof Sandbox.getOrCreate>[0]) => Promise<Sandbox>
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
  action?: 'stop' | 'renew' | undefined
}): void => {
  const live = args.sandbox.currentSession().sessionId
  if (args.expected === undefined || live === args.expected) return
  const action = args.action ?? 'stop'
  throw new Error(
    `refusing to ${action} sandbox ${args.name}: its live session ${live} is not the session ${args.expected} this ${action} was issued for`,
  )
}

export const sandboxSessionIdOf = (sandbox: Sandbox): string | undefined => {
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

export const SANDBOX_SESSION_HARD_LIMIT_MS = 24 * 60 * 60 * 1000

/**
 * Extends exactly the session serve runs in. `Session.extendTimeout` is used instead of
 * `Sandbox.extendTimeout` because the latter wraps the call in `withResume`, which would wake a
 * stopped sandbox into a new session (@vercel/sandbox 3.3.0 dist/sandbox.js:819).
 */
export const renewSessionDeadline = async (args: {
  sandbox: Sandbox
  name: string
  sessionId: string
  until: number
}): Promise<SandboxDeadlineObservation> => {
  assertLiveSession({
    sandbox: args.sandbox,
    name: args.name,
    expected: args.sessionId,
    action: 'renew',
  })
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
  return {
    sessionId: session.sessionId,
    expiresAt: args.sandbox.expiresAt?.getTime() ?? null,
    startedAt: session.startedAt?.getTime() ?? null,
    extendedByMs,
  }
}
