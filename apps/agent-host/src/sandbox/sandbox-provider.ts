import type { VercelCredentials } from './constants'

export type DaemonEndpoint = { url: string; token: string; sandboxName: string }

export const sandboxNameOf = (sandboxSessionId: string): string => `atlas-v2-${sandboxSessionId}`

export abstract class SandboxProvider {
  abstract wake(args: {
    sandboxSessionId: string
    credentials: VercelCredentials
    signal: AbortSignal
  }): Promise<DaemonEndpoint>
  abstract stop(args: { sandboxSessionId: string; credentials: VercelCredentials }): Promise<void>
  abstract keepAlive(args: {
    sandboxSessionId: string
    credentials: VercelCredentials
    until: number
  }): Promise<void>
}
