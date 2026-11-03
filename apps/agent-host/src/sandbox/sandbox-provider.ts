import type { VercelCredentials } from '@dltech/atlas-wire'

export type DaemonEndpoint = { url: string; token: string; sandboxName: string }

export const sandboxNameOf = (sessionId: string): string => `atlas-v2-${sessionId}`

export abstract class SandboxProvider {
  abstract wake(args: {
    sessionId: string
    credentials: VercelCredentials
    signal: AbortSignal
  }): Promise<DaemonEndpoint>
  abstract stop(args: { sessionId: string; credentials: VercelCredentials }): Promise<void>
  abstract keepAlive(args: {
    sessionId: string
    credentials: VercelCredentials
    until: number
  }): Promise<void>
}
