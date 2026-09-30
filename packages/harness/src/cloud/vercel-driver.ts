import { randomBytes } from 'node:crypto'

import { Sandbox } from '@vercel/sandbox'

import {
  detachThenDeleteDrive,
  ensureDrive,
  liveDriveSdk,
  waitForDriveDetached,
  type DriveSdk,
} from './drive-lifecycle'
import { driveNameFor, DRIVE_HOME_PATH, DRIVE_MOUNT_PATH, DRIVE_WORKSPACE_PATH } from './drive-names'
import {
  ESandboxProbe,
  probeClientsAttached,
  probeSandboxForResume,
  type AttachProbe,
} from './resume-probe'
import { attachLagRetry, retrySleep, type RetryPolicy } from './retry-policy'
import { ECloudSandboxState } from './sandbox-client'
import {
  createServeLauncher,
  SERVE_LOG_PATH,
  type ServeLauncher,
} from './serve-launch'
import {
  asVercelFailure,
  EVercelFailure,
  failureTextOf,
  isDriveAttachedConflict,
  isSandboxMissing,
  SandboxMissingError,
  VercelFailure,
} from './vercel-errors'

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

const SANDBOX_LAUNCH_TIMEOUT_MS = 60_000
const SANDBOX_QUICK_TIMEOUT_MS = 30_000
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
  state: ECloudSandboxState
  /** True only when the SDK's `onCreate` hook fired: a genuinely new sandbox, not a resumed one. */
  created: boolean
  /** The drive the sandbox mounted, so the claim row can record it. */
  driveName: string
  /**
   * The serve token the sandbox runs with — minted on this machine unless the caller passed one in.
   * The bridge hands it to the attach so the channel and the sandbox agree without a control plane.
   */
  token: string
  /**
   * Set when the drift probe found the sandbox's serve outdated but kept it because a client is
   * attached — the version it carries, so the operator can be told the pinned one is pending.
   */
  outdatedServe?: string | undefined
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

/**
 * Bun's fetch throws BrotliDecompressionError on Vercel's streamed cmd responses, so the driver
 * negotiates gzip — the one content-coding Bun decompresses reliably here.
 */
const gzipOnlyFetch = Object.assign(
  (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers)
    headers.set('accept-encoding', 'gzip, deflate')
    return fetch(input, { ...init, headers })
  },
  { preconnect: fetch.preconnect },
)

const liveSdk: VercelSdk = {
  getOrCreate: (params) => Sandbox.getOrCreate({ ...params, fetch: gzipOnlyFetch }),
  get: (params) => Sandbox.get({ ...params, fetch: gzipOnlyFetch }),
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
  private readonly attachProbe: AttachProbe = probeClientsAttached
  private readonly attachLagRetry: RetryPolicy

  private readonly drives: DriveSdk

  constructor(
    private readonly args: {
      credentials: VercelCredentials
      cloudUrl: string
      /** Only createOrResume boots one, so an exposure-only driver never names one. */
      image?: string | undefined
      /** Same pin as `VercelSandboxConfig.serveVersion`; a direct driver construction names it here. */
      serveVersion?: string | undefined
      timeoutMs?: number | undefined
      log?: ((line: string) => void) | undefined
      sdk?: VercelSdk | undefined
      driveSdk?: DriveSdk | undefined
      /** The attach-detach lag budget the delete and mount retries share; a spec passes zero delays. */
      attachLagRetry?: RetryPolicy | undefined
      /**
       * Whether a client socket is attached to the sandbox's running serve — the drift probe
       * consults it before destroying an outdated sandbox. Defaults to the serve's own
       * `/v1/health` `clients` count, read through a command inside the sandbox.
       */
      clientsAttached?: AttachProbe | undefined
    },
  ) {
    this.sdk = args.sdk ?? liveSdk
    this.drives = args.driveSdk ?? liveDriveSdk
    this.attachLagRetry = args.attachLagRetry ?? attachLagRetry
    if (args.clientsAttached !== undefined) this.attachProbe = args.clientsAttached
  }

  async createOrResume(args: {
    name: string
    threadId: string
    /**
     * The session's serve token, minted on this machine when omitted — the claim's token is a
     * caller override from the bridge slice, which still owns the wire side of it.
     */
    token?: string | undefined
    pinnedModel?: string | undefined
    /**
     * Writes the session's bootstrap onto the drive. Runs after the sandbox exists (the drive is
     * mounted) and before serve launches, so serve finds the workspace spec and context archive on
     * its first read. Receives the live sandbox — on a fresh boot the name does not resolve until
     * getOrCreate returns, so the callback writes through the sandbox it is handed, not a lookup.
     */
    putContextOnFreshBoot?: ((sandbox: Sandbox) => Promise<void>) | undefined
    /**
     * Extra environment for the sandbox process, resolved by the caller at lift time — the
     * settings a cloud session should inherit from the operator's machine (the decision-model
     * URL, classifier mode, search backend). The sandbox is a fresh container with no local
     * settings files, so anything not handed here reads as its fallback there.
     */
    environment?: Record<string, string> | undefined
  }): Promise<SandboxPlacement> {
    if (this.args.image === undefined) {
      throw new Error('this driver was built for port exposure only, not for creating sandboxes')
    }
    const image = this.args.image
    const launchServe: ServeLauncher = (launchArgs) =>
      this.dedupedLaunch({
        sandbox: launchArgs.sandbox,
        launch: createServeLauncher(),
        token: launchArgs.token,
      })
    const serveToken = args.token ?? randomBytes(32).toString('hex')
    const createStartedAt = Date.now()
    let created = false
    try {
      const { credentials } = this.args
      const driveName = driveNameFor({ threadId: args.threadId })
      const drive = await ensureDrive({ sdk: this.drives, credentials, name: driveName })
      const { probe, outdatedServe } = await probeSandboxForResume({
        name: args.name,
        pinned: this.args.serveVersion,
        timeoutMs: SANDBOX_QUICK_TIMEOUT_MS,
        servePort: SANDBOX_SERVE_PORT,
        fetch: () =>
          this.sdk.get({
            ...credentials,
            name: args.name,
            signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
          }),
        clientsAttached: this.attachProbe,
        waitForDriveDetached: () =>
          waitForDriveDetached({
            sdk: this.drives,
            credentials,
            name: driveName,
            retry: this.attachLagRetry,
          }),
        log: this.args.log,
        isMissing: isSandboxMissing,
        toFailure: asVercelFailure,
      })
      const freshBoot = probe === ESandboxProbe.Missing || probe === ESandboxProbe.Replaced
      const sandbox = await this.mountWithRetries({
        credentials,
        name: args.name,
        image,
        drive,
        driveName,
        threadId: args.threadId,
        token: serveToken,
        environment: args.environment,
        pinnedModel: args.pinnedModel,
        onCreate: () => {
          created = true
          return Promise.resolve()
        },
        launchServe,
      })
      const createMs = Date.now() - createStartedAt
      // The bootstrap (context archive, workspace spec) must be on the drive before serve launches —
      // serve reads it at boot, and writing it needs the live sandbox, which only exists now. A fresh
      // boot has no snapshot to fall back on; a resumed one re-uploads because the operator's local
      // context may have moved on (the snapshot is a cache, not the source of truth).
      if (args.putContextOnFreshBoot !== undefined) {
        await args.putContextOnFreshBoot(sandbox)
      }
      const serveStartedAt = Date.now()
      await launchServe({ sandbox, token: serveToken })
      this.args.log?.(
        `sandbox ${args.name} provisioned: get-or-create ${createMs}ms, serve launch ${Date.now() - serveStartedAt}ms`,
      )
      return {
        sessionId: sandbox.currentSession().sessionId,
        url: await routedUrlWithRetries(sandbox),
        state: stateOf(sandbox.status),
        created,
        driveName,
        token: serveToken,
        ...(outdatedServe === undefined ? {} : { outdatedServe }),
      }
    } catch (failure) {
      if (failure instanceof SandboxMissingError) throw failure
      if (failure instanceof VercelFailure) throw failure
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

  /**
   * The serve log tail from a live sandbox, for a lift that stalled before serve went healthy.
   * Answers the log's last bytes, or a marker when the sandbox or the log is not there to read.
   */
  async serveLogTail(args: { name: string }): Promise<string> {
    try {
      const sandbox = await this.sdk.get({
        ...this.args.credentials,
        name: args.name,
        signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
      })
      const read = await sandbox.runCommand({
        cmd: 'sh',
        args: ['-c', `tail -c 3000 ${SERVE_LOG_PATH} 2>/dev/null || echo NO-SERVE-LOG`],
        timeoutMs: SANDBOX_QUICK_TIMEOUT_MS,
      })
      return (await read.stdout()).trim()
    } catch (failure) {
      if (isSandboxMissing(failure)) return '<the sandbox is gone>'
      throw asVercelFailure(failure)
    }
  }

  /**
   * Writes one bootstrap file into the directory serve reads at boot (`<ATLAS_HOME>/bootstrap`).
   * The laptop authors these — the workspace spec, the context and transcript archives — so the
   * sandbox boots off the drive with no control-plane round-trip. Buffering the bytes in memory is
   * safe here: this runs on the operator's machine, not a capped container (the #485 OOM was the
   * API doing this server-side).
   *
   * Takes the live sandbox rather than re-fetching by name: the bootstrap must be writable before
   * serve launches, and on a fresh boot the name does not resolve until `getOrCreate` returns.
   */
  async writeBootstrapFileToSandbox(args: {
    sandbox: Sandbox
    path: string
    content: Uint8Array | string
  }): Promise<void> {
    try {
      await args.sandbox.runCommand({
        cmd: 'sh',
        args: ['-c', `mkdir -p ${DRIVE_HOME_PATH}/bootstrap`],
        timeoutMs: SANDBOX_QUICK_TIMEOUT_MS,
      })
      await args.sandbox.writeFiles([{ path: args.path, content: args.content }])
    } catch (failure) {
      throw asVercelFailure(failure)
    }
  }

  /**
   * Writes one bootstrap file into the directory serve reads at boot (`<ATLAS_HOME>/bootstrap`),
   * resolving the sandbox by name. Used by the post-boot surface (the lift's transcript ship),
   * where the sandbox already exists; the create path uses `writeBootstrapFileToSandbox` instead.
   */
  async writeBootstrapFile(args: {
    name: string
    path: string
    content: Uint8Array | string
  }): Promise<void> {
    try {
      const sandbox = await this.sdk.get({
        ...this.args.credentials,
        name: args.name,
        signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
      })
      await this.writeBootstrapFileToSandbox({
        sandbox,
        path: args.path,
        content: args.content,
      })
    } catch (failure) {
      throw asVercelFailure(failure)
    }
  }

  /** True once the transcript archive the laptop wrote is present on the drive. */
  async transcriptLanded(args: { name: string }): Promise<boolean> {
    try {
      const sandbox = await this.sdk.get({
        ...this.args.credentials,
        name: args.name,
        signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
      })
      const probe = await sandbox.runCommand({
        cmd: 'sh',
        args: ['-c', `test -s ${DRIVE_HOME_PATH}/bootstrap/transcript.tar.gz`],
        timeoutMs: SANDBOX_QUICK_TIMEOUT_MS,
      })
      return probe.exitCode === 0
    } catch (failure) {
      if (isSandboxMissing(failure)) return false
      throw asVercelFailure(failure)
    }
  }

  async destroy(args: { name: string; threadId?: string | undefined }): Promise<void> {
    try {
      const sandbox = await this.sdk.get({
        ...this.args.credentials,
        name: args.name,
        signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
      })
      await sandbox.delete({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
    } catch (failure) {
      if (!isSandboxMissing(failure)) throw asVercelFailure(failure)
    }
    if (args.threadId !== undefined) {
      const driveName = driveNameFor({ threadId: args.threadId })
      const detached = await detachThenDeleteDrive({
        sdk: this.drives,
        credentials: this.args.credentials,
        name: driveName,
        retry: this.attachLagRetry,
      })
      if (!detached) {
        this.args.log?.(
          `drive ${driveName} still read attached when its delete ran — the delete's retry waited out the detach`,
        )
      }
    }
  }

  /**
   * The mount direction of the attach-detach lag: Vercel detaches a drive asynchronously after a
   * sandbox goes away, so a create issued while the drive still reads attached lands
   * `already attached as read-write`. Retries through that window the way deleteDrive retries the
   * delete side; exhaustion surfaces as a typed failure rather than the raw provider text. A
   * stopped-but-live sandbox that still holds the mount lands the same failure and is retried as
   * attach-state lag.
   */
  private async mountWithRetries(args: {
    credentials: VercelCredentials
    name: string
    image: string
    drive: Awaited<ReturnType<DriveSdk['getOrCreate']>>
    driveName: string
    threadId: string
    token: string
    environment?: Record<string, string> | undefined
    pinnedModel?: string | undefined
    onCreate: () => Promise<void>
    launchServe: ServeLauncher
  }): Promise<Sandbox> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.sdk.getOrCreate({
          ...args.credentials,
          name: args.name,
          ports: [SANDBOX_SERVE_PORT],
          timeout: this.args.timeoutMs ?? SANDBOX_TIMEOUT_MS,
          region: SANDBOX_REGION,
          persistent: true,
          resume: true,
          image: args.image,
          mounts: { [DRIVE_MOUNT_PATH]: args.drive },
          onCreate: args.onCreate,
          onResume: (sandbox) => args.launchServe({ sandbox, token: args.token }),
          env: {
            ATLAS_SERVE_TOKEN: args.token,
            ATLAS_SERVE_PORT: String(SANDBOX_SERVE_PORT),
            ATLAS_THREAD_ID: args.threadId,
            ATLAS_CLOUD_URL: this.args.cloudUrl,
            ATLAS_WORKSPACE_DIR: WORKSPACE_PATH,
            ATLAS_HOME: DRIVE_HOME_PATH,
            VERCEL_TOKEN: args.credentials.token,
            VERCEL_TEAM_ID: args.credentials.teamId,
            VERCEL_PROJECT_ID: args.credentials.projectId,
            ...(args.pinnedModel === undefined ? {} : { ATLAS_MODEL: args.pinnedModel }),
            ...args.environment,
          },
          signal: AbortSignal.timeout(SANDBOX_LAUNCH_TIMEOUT_MS),
        })
      } catch (failure) {
        if (!isDriveAttachedConflict(failure)) throw failure
        const retry = this.attachLagRetry
        if (attempt >= retry.attempts) {
          throw new VercelFailure({
            kind: EVercelFailure.DriveAttached,
            message: `drive ${args.driveName} is still attached after ${retry.attempts} attempts to mount it on sandbox ${args.name}: ${failureTextOf(failure)}`,
          })
        }
        this.args.log?.(
          `drive ${args.driveName} still attached to another sandbox (attempt ${attempt}/${retry.attempts}) — waiting out the detach`,
        )
        await retrySleep(retry)
      }
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
    await args.launch({
      sandbox: args.sandbox,
      ...(args.token === undefined ? {} : { token: args.token }),
    })
  }
}
