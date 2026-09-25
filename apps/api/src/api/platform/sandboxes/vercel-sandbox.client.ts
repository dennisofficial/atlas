import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { Drive, Sandbox, type SandboxMounts } from '@vercel/sandbox'
import { EServeEnv, SERVE_TOKEN_PATH, StaleSandboxTokenError } from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { ESandboxDriveMode, ESandboxFactoryRole, ESandboxState } from './sandboxes.types'
import { ServeBinaryService } from './serve-binary'
import { createServeLauncher } from './serve-launch'
import type { ServeLauncher } from './serve-launch'
import { asBadGateway, failureTextOf, isSandboxMissing, vercelMessageOf } from './vercel-sandbox.errors'
import { APIError } from '@vercel/sandbox'

export const SANDBOX_REGION = 'iad1'
export const SANDBOX_SERVE_PORT = 3000
/** Small per-workspace drives; the SDK's default is 1 TiB. */
export const SANDBOX_DRIVE_MAX_BYTES = 50 * 1024 ** 3
/**
 * The workspace lives on the sandbox's own filesystem, which `persistent: true` snapshots on stop
 * and restores on resume. It sits at the root rather than under the SDK's session cwd
 * (/vercel/sandbox): that directory's snapshot semantics are undocumented and have flipped on us
 * once, so Atlas state keeps off it. The path is told to serve rather than inferred, so both
 * halves agree.
 */
export const WORKSPACE_PATH = '/workspace'

const MINUTE_MS = 60_000
const SANDBOX_LAUNCH_TIMEOUT_MS = 60_000
const SANDBOX_QUICK_TIMEOUT_MS = 30_000
const ROUTE_RETRY_ATTEMPTS = 3
const ROUTE_RETRY_DELAY_MS = 1_000
const PARK_PATH = '/v1/park'
const PARK_NOTIFY_TIMEOUT_MS = 3_000

/**
 * The API only stores a hash of serve's session token, so it cannot call serve's authed endpoints
 * directly — this curls localhost from inside the sandbox instead, reading the plaintext token the
 * serve launcher already wrote to disk there. The reason rides an env var rather than the script
 * text, so it can never break out of the curl payload.
 */
const parkNoticeScript = (port: number): string =>
  `_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true); ` +
  `curl -sf -m 2 --connect-timeout 1 -X POST ` +
  `-H "Authorization: Bearer $_serve_token" -H "Content-Type: application/json" ` +
  `-d "$ATLAS_PARK_REASON" "http://localhost:${port}${PARK_PATH}"`

export interface SandboxPlacement {
  sessionId: string
  url: string
  state: ESandboxState
  /** True only when the SDK's `onCreate` hook fired: a genuinely new sandbox, not a resumed one. */
  created: boolean
}

export interface SandboxObservation {
  state: ESandboxState
  url?: string
}

interface SandboxConfiguration {
  token: string
  teamId: string
  projectId: string
  cloudUrl: string
  image: string
}

export class SandboxMissingError extends Error {
  constructor(sandboxName?: string) {
    super(
      sandboxName === undefined
        ? 'sandbox no longer exists on Vercel'
        : `sandbox ${sandboxName} no longer exists on Vercel`,
    )
    this.name = 'SandboxMissingError'
  }
}

const stateOf = (status: string): ESandboxState => {
  if (status === 'running') return ESandboxState.Running
  if (status === 'pending') return ESandboxState.Resuming
  return ESandboxState.Parked
}

const routedUrlOf = (sandbox: Sandbox): string | undefined => {
  try {
    return sandbox.domain(SANDBOX_SERVE_PORT)
  } catch {
    return undefined
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Vercel's exact refusal when a snapshot mount targets a drive whose storage was never
 * initialized by a read-write attach. Keyed on the message because the API returns it as a plain
 * 400 bad_request with no dedicated error code.
 */
const isUninitializedDriveRefusal = (failure: unknown): boolean =>
  failure instanceof APIError &&
  vercelMessageOf(failure).includes('has not been initialized yet')

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

@Injectable()
export class VercelSandboxClient {
  private readonly logger = new Logger(VercelSandboxClient.name)
  private readonly launchServe: ServeLauncher
  private readonly inflightLaunches = new WeakMap<object, Promise<void>>()

  constructor(
    private readonly env: EnvService,
    serveBinary: ServeBinaryService,
  ) {
    const launch = createServeLauncher({ readStamp: () => serveBinary.stamp() })
    this.launchServe = ({ sandbox, token }) => this.dedupedLaunch({ sandbox, launch, token })
  }

  async getOrCreate(args: {
    name: string
    threadId: string
    token: string
    drive?: { name: string; mode: ESandboxDriveMode } | undefined
    pinnedModel?: string | undefined
    factoryRole?: ESandboxFactoryRole | undefined
    decisionsUrl?: string | undefined
  }): Promise<SandboxPlacement> {
    const createStartedAt = Date.now()
    try {
      return await this.boot(args)
    } catch (failure) {
      if (
        args.drive?.mode === ESandboxDriveMode.Snapshot &&
        isUninitializedDriveRefusal(failure)
      ) {
        this.logger.log(
          `drive ${args.drive.name} was never mounted read-write; initializing it with a read-write mount for sandbox ${args.name}`,
        )
        try {
          return await this.boot({
            ...args,
            drive: { name: args.drive.name, mode: ESandboxDriveMode.ReadWrite },
          })
        } catch (retryFailure) {
          if (retryFailure instanceof SandboxMissingError) throw retryFailure
          this.logger.warn(
            `sandbox ${args.name} provision failed on the read-write initializing retry ${Date.now() - createStartedAt}ms in: ${failureTextOf(retryFailure)}`,
          )
          throw asBadGateway(retryFailure)
        }
      }
      if (failure instanceof SandboxMissingError) throw failure
      this.logger.warn(
        `sandbox ${args.name} provision failed ${Date.now() - createStartedAt}ms in: ${failureTextOf(failure)}`,
      )
      throw asBadGateway(failure)
    }
  }

  private async boot(args: {
    name: string
    threadId: string
    token: string
    drive?: { name: string; mode: ESandboxDriveMode } | undefined
    pinnedModel?: string | undefined
    factoryRole?: ESandboxFactoryRole | undefined
    decisionsUrl?: string | undefined
  }): Promise<SandboxPlacement> {
    const configuration = this.configuration()
    const createStartedAt = Date.now()
    let created = false
    const mounts = await this.mountsOf(args.drive)
    const sandbox = await Sandbox.getOrCreate({
      ...this.credentialsOf(configuration),
      name: args.name,
      ports: [SANDBOX_SERVE_PORT],
      timeout: this.maxSessionMs(),
      region: SANDBOX_REGION,
      persistent: true,
      resume: true,
      image: configuration.image,
      onCreate: () => {
        created = true
        return Promise.resolve()
      },
      onResume: (sandbox) => this.launchServe({ sandbox, token: args.token }),
      env: {
        [EServeEnv.Token]: args.token,
        [EServeEnv.Port]: String(SANDBOX_SERVE_PORT),
        [EServeEnv.ThreadId]: args.threadId,
        [EServeEnv.CloudUrl]: configuration.cloudUrl,
        [EServeEnv.WorkspaceDir]: WORKSPACE_PATH,
        ...(args.pinnedModel === undefined ? {} : { [EServeEnv.Model]: args.pinnedModel }),
        ...(args.factoryRole === undefined ? {} : { [EServeEnv.FactoryRole]: args.factoryRole }),
        ...(args.decisionsUrl === undefined ? {} : { [EServeEnv.DecisionsUrl]: args.decisionsUrl }),
      },
      ...(mounts === undefined ? {} : { mounts }),
      signal: AbortSignal.timeout(SANDBOX_LAUNCH_TIMEOUT_MS),
    })
    const createMs = Date.now() - createStartedAt
    const serveStartedAt = Date.now()
    await this.launchServe({ sandbox, token: args.token })
    this.logger.log(
      `sandbox ${args.name} provisioned: get-or-create ${createMs}ms, serve launch ${Date.now() - serveStartedAt}ms`,
    )
    return { ...(await this.placementOf(sandbox)), created }
  }

  async ensureDrive(args: { name: string }): Promise<void> {
    await this.driveFor({ name: args.name, timeoutMs: SANDBOX_LAUNCH_TIMEOUT_MS })
  }

  async deleteDrive(args: { name: string }): Promise<void> {
    try {
      const drives = await Drive.list({
        ...this.credentials(),
        namePrefix: args.name,
        sortBy: 'name',
        signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
      })
      for await (const drive of drives) {
        if (drive.name !== args.name) continue
        await drive.delete({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
      }
    } catch (failure) {
      if (isSandboxMissing(failure)) return
      throw asBadGateway(failure)
    }
  }

  async inspect(args: { name: string }): Promise<SandboxObservation> {
    const credentials = this.credentials()
    try {
      const sandbox = await Sandbox.get({
        ...credentials,
        name: args.name,
        signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
      })
      const url = routedUrlOf(sandbox)
      return { state: stateOf(sandbox.status), ...(url === undefined ? {} : { url }) }
    } catch (failure) {
      if (isSandboxMissing(failure)) return { state: ESandboxState.Parked }
      throw asBadGateway(failure)
    }
  }

  async stop(args: { name: string }): Promise<void> {
    const credentials = this.credentials()
    try {
      const sandbox = await Sandbox.get({
        ...credentials,
        name: args.name,
        signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
      })
      await sandbox.stop({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
    } catch (failure) {
      if (isSandboxMissing(failure)) return
      throw asBadGateway(failure)
    }
  }

  /** Throws on any failure; swallowing it is the caller's job, so a wedged sandbox still stops. */
  async notifyParked(args: { name: string; reason: string }): Promise<void> {
    const credentials = this.credentials()
    const sandbox = await Sandbox.get({
      ...credentials,
      name: args.name,
      signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
    })
    await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', parkNoticeScript(SANDBOX_SERVE_PORT)],
      env: { ATLAS_PARK_REASON: JSON.stringify({ reason: args.reason }) },
      timeoutMs: PARK_NOTIFY_TIMEOUT_MS,
    })
  }

  private async mountsOf(
    drive: { name: string; mode: ESandboxDriveMode } | undefined,
  ): Promise<SandboxMounts | undefined> {
    if (drive === undefined) return undefined
    const created = await this.driveFor({
      name: drive.name,
      timeoutMs: SANDBOX_LAUNCH_TIMEOUT_MS,
    })
    return {
      [WORKSPACE_PATH]:
        drive.mode === ESandboxDriveMode.Snapshot ? created.snapshot() : created,
    }
  }

  private driveFor(args: { name: string; timeoutMs: number }): Promise<Drive> {
    return Drive.getOrCreate({
      ...this.credentials(),
      name: args.name,
      region: SANDBOX_REGION,
      maxSize: SANDBOX_DRIVE_MAX_BYTES,
      signal: AbortSignal.timeout(args.timeoutMs),
    })
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
      await args.launch({ sandbox: args.sandbox, ...(args.token === undefined ? {} : { token: args.token }) })
    } catch (failure) {
      if (!(failure instanceof StaleSandboxTokenError)) throw failure
      await args.sandbox
        .delete({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
        .catch(() => undefined)
      throw new SandboxMissingError(args.sandbox.name)
    }
  }

  private async placementOf(sandbox: Sandbox): Promise<Omit<SandboxPlacement, 'created'>> {
    return {
      sessionId: sandbox.currentSession().sessionId,
      url: await routedUrlWithRetries(sandbox),
      state: stateOf(sandbox.status),
    }
  }

  private maxSessionMs(): number {
    return this.env.get('SANDBOX_MAX_SESSION_MINUTES') * MINUTE_MS
  }

  private credentials(): Pick<SandboxConfiguration, 'token' | 'teamId' | 'projectId'> {
    return this.credentialsOf(this.configuration())
  }

  private credentialsOf(
    configuration: SandboxConfiguration,
  ): Pick<SandboxConfiguration, 'token' | 'teamId' | 'projectId'> {
    return {
      token: configuration.token,
      teamId: configuration.teamId,
      projectId: configuration.projectId,
    }
  }

  private configuration(): SandboxConfiguration {
    const token = this.env.get('VERCEL_TOKEN')
    const teamId = this.env.get('VERCEL_TEAM_ID')
    const projectId = this.env.get('VERCEL_PROJECT_ID')
    const cloudUrl = this.env.get('ATLAS_CLOUD_URL')
    const image = this.env.get('SANDBOX_IMAGE')
    if (
      token === undefined ||
      teamId === undefined ||
      projectId === undefined ||
      cloudUrl === undefined ||
      image === undefined
    ) {
      throw new ServiceUnavailableException(
        'Atlas Cloud sandboxes are not configured on this deployment',
      )
    }
    return { token, teamId, projectId, cloudUrl, image }
  }
}
