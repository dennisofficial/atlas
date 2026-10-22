import { Injectable } from '@nestjs/common'
import { Sandbox } from '@vercel/sandbox'
import { assertLiveSession, SANDBOX_MAX_PORTS, SERVE_TOKEN_PATH } from '@dltech/atlas-wire'
import { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'
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

@Injectable()
export class VercelSandboxClient {
  constructor(private readonly credentials: SandboxCredentials) {}

  async inspect(args: { threadId: string; name: string }): Promise<SandboxObservation> {
    try {
      const sandbox = await this.get(args)
      const url = routedUrlOf(sandbox)
      return { state: stateOf(sandbox.status), ...(url === undefined ? {} : { url }) }
    } catch (failure) {
      if (isSandboxMissing(failure)) return { state: ESandboxState.Parked }
      throw asBadGateway(failure)
    }
  }

  async stop(args: { threadId: string; name: string }): Promise<void> {
    await this.stopSession(args)
  }

  async stopSession(args: {
    threadId: string
    name: string
    sessionId?: string | undefined
  }): Promise<void> {
    try {
      const sandbox = await this.get({ ...args, resume: false })
      assertLiveSession({ sandbox, name: args.name, expected: args.sessionId })
      await sandbox.stop({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
    } catch (failure) {
      if (isSandboxMissing(failure)) return
      throw asBadGateway(failure)
    }
  }

  /**
   * `update` replaces the whole port list, so the already-routed ports go back in alongside the
   * new one — omitting them would deregister the serve port and cut the session's own channel.
   */
  async exposePort(args: { threadId: string; name: string; port: number }): Promise<string> {
    try {
      const sandbox = await this.get(args)
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
      throw asBadGateway(failure)
    }
  }

  /** Throws on any failure; swallowing it is the caller's job, so a wedged sandbox still stops. */
  async notifyParked(args: { threadId: string; name: string; reason: string }): Promise<void> {
    const sandbox = await this.get(args)
    await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', parkNoticeScript(SANDBOX_SERVE_PORT)],
      env: { ATLAS_PARK_REASON: JSON.stringify({ reason: args.reason }) },
      timeoutMs: PARK_NOTIFY_TIMEOUT_MS,
    })
  }

  private async get(args: { threadId: string; name: string; resume?: boolean }): Promise<Sandbox> {
    const { token, teamId, projectId } = await this.credentials.forThread({
      threadId: args.threadId,
    })
    return Sandbox.get({
      token,
      teamId,
      projectId,
      name: args.name,
      ...(args.resume === undefined ? {} : { resume: args.resume }),
      signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
    })
  }
}
