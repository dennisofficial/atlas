import { Sandbox } from '@vercel/sandbox'

import { ECloudSandboxState } from './sandbox-client'
import {
  createServeLauncher,
  StaleSandboxTokenError,
  type ServeLauncher,
} from './serve-launch'
import {
  asVercelFailure,
  failureTextOf,
  isSandboxMissing,
  SandboxMissingError,
} from './vercel-errors'

export const SANDBOX_REGION = 'iad1'
export const SANDBOX_SERVE_PORT = 3000
/** The SDK's per-sandbox ceiling; the serve port occupies one slot. */
export const SANDBOX_MAX_PORTS = 15
/**
 * The workspace lives on the sandbox's own filesystem, which `persistent: true` snapshots on stop
 * and restores on resume. It sits at the root rather than under the SDK's session cwd
 * (/vercel/sandbox): that directory's snapshot semantics are undocumented and have flipped on us
 * once, so Atlas state keeps off it. The path is told to serve rather than inferred, so both
 * halves agree.
 */
export const WORKSPACE_PATH = '/workspace'

/** Set once at creation and never extended: an idle sandbox parks itself. */
export const SANDBOX_TIMEOUT_MS = 4 * 60 * 60 * 1000

const SANDBOX_LAUNCH_TIMEOUT_MS = 60_000
const SANDBOX_QUICK_TIMEOUT_MS = 30_000
const ROUTE_RETRY_ATTEMPTS = 3
const ROUTE_RETRY_DELAY_MS = 1_000

export type VercelCredentials = { token: string; teamId: string; projectId: string }

export type VercelSandboxConfig = { credentials: VercelCredentials; image: string }

export type SandboxPlacement = {
  sessionId: string
  url: string
  state: ECloudSandboxState
  /** True only when the SDK's `onCreate` hook fired: a genuinely new sandbox, not a resumed one. */
  created: boolean
}

export type SandboxObservation = {
  state: ECloudSandboxState
  url?: string
}

/** The static SDK surface the driver uses, injectable so a spec never reaches Vercel. */
export type VercelSdk = {
  getOrCreate: (
    params: Parameters<typeof Sandbox.getOrCreate>[0],
  ) => Promise<Sandbox>
  get: (params: Parameters<typeof Sandbox.get>[0]) => Promise<Sandbox>
}

const liveSdk: VercelSdk = {
  getOrCreate: (params) => Sandbox.getOrCreate(params),
  get: (params) => Sandbox.get(params),
}

const stateOf = (status: string): ECloudSandboxState => {
  if (status === 'running') return ECloudSandboxState.Running
  if (status === 'pending') return ECloudSandboxState.Resuming
  return ECloudSandboxState.Parked
}

const routedUrlOf = (sandbox: Sandbox): string | undefined => {
  try {
    return sandbox.domain(SANDBOX_SERVE_PORT)
  } catch {
    return undefined
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const routedUrlWithRetries = async (sandbox: Sandbox): Promise<string> => {
  for (let attempt = 1; attempt <= ROUTE_RETRY_ATTEMPTS; attempt += 1) {
    const url = routedUrlOf(sandbox)
    if (url !== undefined) return url
    if (attempt < ROUTE_RETRY_ATTEMPTS) await sleep(ROUTE_RETRY_DELAY_MS)
  }
  throw new Error(
    `sandbox ${sandbox.name} has no route for port ${SANDBOX_SERVE_PORT} after ${ROUTE_RETRY_ATTEMPTS} attempts`,
  )
}

/**
 * Everything Atlas needs from Vercel, driven with the operator's own token: the control plane
 * keeps the rendezvous rows and the credential brokering, and every sandbox call happens here.
 * Ported from apps/api's VercelSandboxClient with Nest stripped — drives, timeout extension and
 * park notification died with the server-side reaper.
 */
export class VercelDriver {
  private readonly sdk: VercelSdk
  private readonly inflightLaunches = new WeakMap<object, Promise<void>>()

  constructor(
    private readonly args: {
      credentials: VercelCredentials
      cloudUrl: string
      /** Only createOrResume boots one, so an exposure-only driver never names one. */
      image?: string | undefined
      timeoutMs?: number | undefined
      log?: ((line: string) => void) | undefined
      sdk?: VercelSdk | undefined
    },
  ) {
    this.sdk = args.sdk ?? liveSdk
  }

  async createOrResume(args: {
    name: string
    threadId: string
    token: string
    /** The stamp the claim's fresh session token authorizes reading — per call, never held. */
    readStamp: () => Promise<string>
    pinnedModel?: string | undefined
  }): Promise<SandboxPlacement> {
    if (this.args.image === undefined) {
      throw new Error('this driver was built for port exposure only, not for creating sandboxes')
    }
    const image = this.args.image
    const launchServe: ServeLauncher = (launchArgs) =>
      this.dedupedLaunch({
        sandbox: launchArgs.sandbox,
        launch: createServeLauncher({ readStamp: args.readStamp }),
        token: launchArgs.token,
      })
    const createStartedAt = Date.now()
    let created = false
    try {
      const { credentials } = this.args
      const sandbox = await this.sdk.getOrCreate({
        ...credentials,
        name: args.name,
        ports: [SANDBOX_SERVE_PORT],
        timeout: this.args.timeoutMs ?? SANDBOX_TIMEOUT_MS,
        region: SANDBOX_REGION,
        persistent: true,
        resume: true,
        image,
        onCreate: () => {
          created = true
          return Promise.resolve()
        },
        onResume: (sandbox) => launchServe({ sandbox, token: args.token }),
        env: {
          ATLAS_SERVE_TOKEN: args.token,
          ATLAS_SERVE_PORT: String(SANDBOX_SERVE_PORT),
          ATLAS_THREAD_ID: args.threadId,
          ATLAS_CLOUD_URL: this.args.cloudUrl,
          ATLAS_WORKSPACE_DIR: WORKSPACE_PATH,
          VERCEL_TOKEN: credentials.token,
          VERCEL_TEAM_ID: credentials.teamId,
          VERCEL_PROJECT_ID: credentials.projectId,
          ...(args.pinnedModel === undefined ? {} : { ATLAS_MODEL: args.pinnedModel }),
        },
        signal: AbortSignal.timeout(SANDBOX_LAUNCH_TIMEOUT_MS),
      })
      const createMs = Date.now() - createStartedAt
      const serveStartedAt = Date.now()
      await launchServe({ sandbox, token: args.token })
      this.args.log?.(
        `sandbox ${args.name} provisioned: get-or-create ${createMs}ms, serve launch ${Date.now() - serveStartedAt}ms`,
      )
      return {
        sessionId: sandbox.currentSession().sessionId,
        url: await routedUrlWithRetries(sandbox),
        state: stateOf(sandbox.status),
        created,
      }
    } catch (failure) {
      if (failure instanceof SandboxMissingError) throw failure
      this.args.log?.(
        `sandbox ${args.name} provision failed ${Date.now() - createStartedAt}ms in: ${failureTextOf(failure)}`,
      )
      throw asVercelFailure(failure)
    }
  }

  /**
   * `undefined` when Vercel has never heard of the name — distinct from parked, which is a sandbox
   * with a snapshot to resume from. Callers use the difference to tell whether a wake needs the
   * context archive uploaded again.
   */
  async inspect(args: { name: string }): Promise<SandboxObservation | undefined> {
    try {
      const sandbox = await this.sdk.get({
        ...this.args.credentials,
        name: args.name,
        signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
      })
      const url = routedUrlOf(sandbox)
      return { state: stateOf(sandbox.status), ...(url === undefined ? {} : { url }) }
    } catch (failure) {
      if (isSandboxMissing(failure)) return undefined
      throw asVercelFailure(failure)
    }
  }

  /**
   * `update` replaces the whole port list, so the already-routed ports go back in alongside the
   * new one — omitting them would deregister the serve port and cut the session's own channel.
   */
  async exposePort(args: { name: string; port: number }): Promise<string> {
    try {
      const sandbox = await this.sdk.get({
        ...this.args.credentials,
        name: args.name,
        signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
      })
      const routed = sandbox.routes.map((route) => route.port)
      if (!routed.includes(args.port)) {
        if (routed.length >= SANDBOX_MAX_PORTS) {
          throw new Error(
            `a sandbox exposes at most ${SANDBOX_MAX_PORTS} ports and this one is at the limit`,
          )
        }
        await sandbox.update(
          { ports: [...routed, args.port] },
          { signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) },
        )
      }
      return sandbox.domain(args.port)
    } catch (failure) {
      if (isSandboxMissing(failure)) throw new SandboxMissingError(args.name)
      throw asVercelFailure(failure)
    }
  }

  async stop(args: { name: string }): Promise<void> {
    try {
      const sandbox = await this.sdk.get({
        ...this.args.credentials,
        name: args.name,
        signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
      })
      await sandbox.stop({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
    } catch (failure) {
      if (isSandboxMissing(failure)) return
      throw asVercelFailure(failure)
    }
  }

  async destroy(args: { name: string }): Promise<void> {
    try {
      const sandbox = await this.sdk.get({
        ...this.args.credentials,
        name: args.name,
        signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
      })
      await sandbox.delete({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
    } catch (failure) {
      if (isSandboxMissing(failure)) return
      throw asVercelFailure(failure)
    }
  }

  private async dedupedLaunch(args: {
    sandbox: Sandbox
    launch: ServeLauncher
    token?: string | undefined
  }): Promise<void> {
    const existing = this.inflightLaunches.get(args.sandbox)
    if (existing !== undefined) return existing
    const attempt = this.healedLaunch(args).finally(() => {
      this.inflightLaunches.delete(args.sandbox)
    })
    this.inflightLaunches.set(args.sandbox, attempt)
    return attempt
  }

  private async healedLaunch(args: {
    sandbox: Sandbox
    launch: ServeLauncher
    token?: string | undefined
  }): Promise<void> {
    try {
      await args.launch({
        sandbox: args.sandbox,
        ...(args.token === undefined ? {} : { token: args.token }),
      })
    } catch (failure) {
      if (!(failure instanceof StaleSandboxTokenError)) throw failure
      await args.sandbox
        .delete({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
        .catch(() => undefined)
      throw new SandboxMissingError(args.sandbox.name)
    }
  }
}
