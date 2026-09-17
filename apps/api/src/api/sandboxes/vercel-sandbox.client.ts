import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { APIError, Sandbox } from '@vercel/sandbox'
import { EnvService } from '../../_core/config/env/env.service'
import { ESandboxState } from './sandboxes.types'
import { ServeBinaryService } from './serve-binary'
import { createServeLauncher, StaleSandboxTokenError, type ServeLauncher } from './serve-launch'

export const SANDBOX_REGION = 'iad1'
export const SANDBOX_SERVE_PORT = 3000
/**
 * The workspace lives on the sandbox's own filesystem, which `persistent: true` snapshots on stop
 * and restores on resume. The path is told to serve rather than inferred, so both halves agree.
 */
export const WORKSPACE_PATH = '/vercel/sandbox/workspace'

const MINUTE_MS = 60_000
const SANDBOX_LAUNCH_TIMEOUT_MS = 60_000
const SANDBOX_QUICK_TIMEOUT_MS = 30_000
const ROUTE_RETRY_ATTEMPTS = 3
const ROUTE_RETRY_DELAY_MS = 1_000

export interface SandboxPlacement {
  sessionId: string
  url: string
  state: ESandboxState
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

const snapshotCodeOf = (json: unknown): string | undefined => {
  if (typeof json !== 'object' || json === null) return undefined
  const error = (json as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

const vercelMessageOf = (error: APIError<unknown>): string => {
  if (typeof error.json === 'object' && error.json !== null) {
    const errorField = (error.json as { error?: unknown }).error
    if (typeof errorField === 'object' && errorField !== null) {
      const message = (errorField as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
  }
  return error.message
}

const isSandboxMissing = (error: unknown): boolean => {
  if (!(error instanceof APIError)) return false
  if (error.response.status === 404) return true
  return error.response.status === 410 && snapshotCodeOf(error.json) === 'snapshot_not_found'
}

const asBadGateway = (failure: unknown): BadGatewayException => {
  if (failure instanceof APIError) return new BadGatewayException(vercelMessageOf(failure))
  if (failure instanceof Error) return new BadGatewayException(failure.message)
  return new BadGatewayException('the sandbox provider failed unexpectedly')
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
  private readonly launchServe: ServeLauncher
  private readonly inflightLaunches = new WeakMap<object, Promise<void>>()

  constructor(
    private readonly env: EnvService,
    serveBinary: ServeBinaryService,
  ) {
    const launch = createServeLauncher({ readStamp: () => serveBinary.stamp() })
    this.launchServe = (sandbox) => this.dedupedLaunch(sandbox, launch)
  }

  async getOrCreate(args: {
    name: string
    threadId: string
    token: string
  }): Promise<SandboxPlacement> {
    const configuration = this.configuration()
    try {
      const sandbox = await Sandbox.getOrCreate({
        ...this.credentialsOf(configuration),
        name: args.name,
        ports: [SANDBOX_SERVE_PORT],
        timeout: this.maxSessionMs(),
        region: SANDBOX_REGION,
        persistent: true,
        resume: true,
        image: configuration.image,
        onResume: this.launchServe,
        env: {
          ATLAS_SERVE_TOKEN: args.token,
          ATLAS_SERVE_PORT: String(SANDBOX_SERVE_PORT),
          ATLAS_THREAD_ID: args.threadId,
          ATLAS_CLOUD_URL: configuration.cloudUrl,
          ATLAS_WORKSPACE_DIR: WORKSPACE_PATH,
        },
        signal: AbortSignal.timeout(SANDBOX_LAUNCH_TIMEOUT_MS),
      })
      await this.launchServe(sandbox)
      return await this.placementOf(sandbox)
    } catch (failure) {
      if (failure instanceof SandboxMissingError) throw failure
      throw asBadGateway(failure)
    }
  }

  async destroy(args: { name: string }): Promise<void> {
    const credentials = this.credentials()
    try {
      const sandbox = await Sandbox.get({
        ...credentials,
        name: args.name,
        signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
      })
      await sandbox.delete({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
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

  private async dedupedLaunch(sandbox: Sandbox, launch: ServeLauncher): Promise<void> {
    const existing = this.inflightLaunches.get(sandbox)
    if (existing !== undefined) return existing
    const attempt = this.healedLaunch(sandbox, launch).finally(() => {
      this.inflightLaunches.delete(sandbox)
    })
    this.inflightLaunches.set(sandbox, attempt)
    return attempt
  }

  private async healedLaunch(sandbox: Sandbox, launch: ServeLauncher): Promise<void> {
    try {
      await launch(sandbox)
    } catch (failure) {
      if (!(failure instanceof StaleSandboxTokenError)) throw failure
      await sandbox
        .delete({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
        .catch(() => undefined)
      throw new SandboxMissingError(sandbox.name)
    }
  }

  private async placementOf(sandbox: Sandbox): Promise<SandboxPlacement> {
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
