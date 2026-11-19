import { ESandboxProvider } from '@dltech/atlas-protocol'

export type SandboxCredentials =
  | { provider: ESandboxProvider.Vercel; token: string; teamId: string; projectId: string }
  | { provider: ESandboxProvider.Agent37; apiKey: string }

export type SandboxTarget = { sandboxSessionId: string; credentials: SandboxCredentials }

export type DaemonEndpoint = { url: string; token: string; sandboxName: string }

export abstract class SandboxProvider {
  abstract wake(args: {
    target: SandboxTarget
    signal: AbortSignal
    vcpus?: number | undefined
  }): Promise<DaemonEndpoint>
  abstract stop(args: { target: SandboxTarget }): Promise<void>
  abstract keepAlive(args: { target: SandboxTarget; until: number }): Promise<void>
  abstract resize(args: { target: SandboxTarget; vcpus: number }): Promise<void>
}
