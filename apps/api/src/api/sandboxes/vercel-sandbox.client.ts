import { readFile } from 'node:fs/promises'
import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { Sandbox } from '@vercel/sandbox'
import { EnvService } from '../../_core/config/env/env.service'
import { ESandboxState } from './sandboxes.types'
import { createServeLauncher, type ServeLauncher } from './serve-launch'

export const SANDBOX_REGION = 'iad1'
export const SANDBOX_SERVE_PORT = 3000
/**
 * The workspace lives on the sandbox's own filesystem, which `persistent: true` snapshots on stop
 * and restores on resume. The path is told to serve rather than inferred, so both halves agree.
 */
export const WORKSPACE_PATH = '/vercel/sandbox/workspace'

const MINUTE_MS = 60_000

const DEFAULT_SERVE_BINARY_PATH = '/app/atlas-serve'

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

@Injectable()
export class VercelSandboxClient {
  private readonly launchServe: ServeLauncher

  constructor(private readonly env: EnvService) {
    this.launchServe = createServeLauncher({ readBinary: () => this.serveBinary() })
  }

  async getOrCreate(args: {
    name: string
    threadId: string
    token: string
  }): Promise<SandboxPlacement> {
    const configuration = this.configuration()
    const sandbox = await Sandbox.getOrCreate({
      ...this.credentialsOf(configuration),
      name: args.name,
      ports: [SANDBOX_SERVE_PORT],
      timeout: this.maxSessionMs(),
      region: SANDBOX_REGION,
      persistent: true,
      resume: true,
      image: this.env.get('SANDBOX_IMAGE'),
      onResume: this.launchServe,
      env: {
        ATLAS_SERVE_TOKEN: args.token,
        ATLAS_SERVE_PORT: String(SANDBOX_SERVE_PORT),
        ATLAS_THREAD_ID: args.threadId,
        ATLAS_CLOUD_URL: configuration.cloudUrl,
        ATLAS_WORKSPACE_DIR: WORKSPACE_PATH,
      },
    })
    await this.launchServe(sandbox)
    return this.placementOf(sandbox)
  }

  async resume(args: { name: string }): Promise<SandboxPlacement> {
    const sandbox = await Sandbox.get({
      ...this.credentials(),
      name: args.name,
      resume: true,
      onResume: this.launchServe,
    })
    await this.launchServe(sandbox)
    return this.placementOf(sandbox)
  }

  async inspect(args: { name: string }): Promise<SandboxObservation> {
    const sandbox = await Sandbox.get({ ...this.credentials(), name: args.name })
    const url = routedUrlOf(sandbox)
    return { state: stateOf(sandbox.status), ...(url === undefined ? {} : { url }) }
  }

  async stop(args: { name: string }): Promise<void> {
    const sandbox = await Sandbox.get({ ...this.credentials(), name: args.name })
    await sandbox.stop()
  }

  private placementOf(sandbox: Sandbox): SandboxPlacement {
    return {
      sessionId: sandbox.currentSession().sessionId,
      url: sandbox.domain(SANDBOX_SERVE_PORT),
      state: stateOf(sandbox.status),
    }
  }

  private maxSessionMs(): number {
    return this.env.get('SANDBOX_MAX_SESSION_MINUTES') * MINUTE_MS
  }

  private async serveBinary(): Promise<Uint8Array> {
    const path = this.env.get('SANDBOX_SERVE_BINARY') ?? DEFAULT_SERVE_BINARY_PATH
    try {
      return await readFile(path)
    } catch {
      throw new ServiceUnavailableException(
        `this deployment has no atlas serve binary at ${path}`,
      )
    }
  }

  private credentials(): Omit<SandboxConfiguration, 'cloudUrl'> {
    return this.credentialsOf(this.configuration())
  }

  private credentialsOf(
    configuration: SandboxConfiguration,
  ): Omit<SandboxConfiguration, 'cloudUrl'> {
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
    if (
      token === undefined ||
      teamId === undefined ||
      projectId === undefined ||
      cloudUrl === undefined
    ) {
      throw new ServiceUnavailableException(
        'Atlas Cloud sandboxes are not configured on this deployment',
      )
    }
    return { token, teamId, projectId, cloudUrl }
  }
}
