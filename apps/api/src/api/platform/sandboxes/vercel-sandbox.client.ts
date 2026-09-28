import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { Drive, Sandbox } from '@vercel/sandbox'
import { SERVE_TOKEN_PATH } from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { ESandboxState } from './sandboxes.types'
import { asBadGateway, isSandboxMissing } from './vercel-sandbox.errors'

export const SANDBOX_REGION = 'iad1'
export const SANDBOX_SERVE_PORT = 3000

const SANDBOX_QUICK_TIMEOUT_MS = 30_000
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

export interface SandboxObservation {
  state: ESandboxState
  url?: string
}

interface SandboxConfiguration {
  token: string
  teamId: string
  projectId: string
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

/**
 * The read-and-stop surface the API still needs on a BYO sandbox. The harness owns provisioning
 * with the operator's own Vercel token, so nothing here boots, launches, or downloads serve —
 * only inspect, park notification, stop, and the drive sweep a teardown calls.
 */
@Injectable()
export class VercelSandboxClient {
  constructor(private readonly env: EnvService) {}

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

  private credentials(): SandboxConfiguration {
    const token = this.env.get('VERCEL_TOKEN')
    const teamId = this.env.get('VERCEL_TEAM_ID')
    const projectId = this.env.get('VERCEL_PROJECT_ID')
    if (token === undefined || teamId === undefined || projectId === undefined) {
      throw new ServiceUnavailableException(
        'Atlas Cloud sandboxes are not configured on this deployment',
      )
    }
    return { token, teamId, projectId }
  }
}
