import { EPodResizeProbe, type PodShape } from '@dltech/atlas-core'
import { ESandboxProvider } from '@dltech/atlas-protocol'

export type SandboxCredentials =
  | { provider: ESandboxProvider.Vercel; token: string; teamId: string; projectId: string }
  | { provider: ESandboxProvider.Agent37; apiKey: string }

export type SandboxTarget = { sandboxSessionId: string; credentials: SandboxCredentials }

export type DaemonEndpoint = {
  url: string
  token: string
  sandboxName: string
  vcpus?: number | undefined
  memoryGb?: number | undefined
  diskGb?: number | undefined
}

export type PodResizeOutcome = 'restarted' | 'stored' | 'absent'

/** One pod sandbox a provider holds, named by its pod session rather than by any provider's name. */
export type SandboxListing = {
  sandboxSessionId: string
  running: boolean
  createdAt: number
}

export abstract class SandboxProvider {
  abstract wake(args: {
    target: SandboxTarget
    signal: AbortSignal
    vcpus?: number | undefined
    memoryGb?: number | undefined
    diskGb?: number | undefined
  }): Promise<DaemonEndpoint>
  abstract stop(args: { target: SandboxTarget }): Promise<void>
  abstract keepAlive(args: { target: SandboxTarget; until: number }): Promise<void>
  abstract resize(args: {
    target: SandboxTarget
    shape: PodShape
    diskGb?: number | undefined
  }): Promise<PodResizeOutcome>
  /**
   * Idempotent: a sandbox that is already gone is success, and a running one is left untouched —
   * only stopped storage is deleted, so a pod that came alive is never deleted under its user.
   */
  abstract delete(args: { target: SandboxTarget }): Promise<void>
  /** Every pod sandbox this provider created for the credentials, all pages of them. */
  abstract list(args: { credentials: SandboxCredentials }): Promise<readonly SandboxListing[]>
  async activeCpuMs(_args: { target: SandboxTarget }): Promise<number | undefined> {
    return undefined
  }
  async instanceIdOf(_args: { target: SandboxTarget }): Promise<string | undefined> {
    return undefined
  }
  podDiskGb(): number | undefined {
    return undefined
  }

  async resizeState(_args: { target: SandboxTarget; shape: PodShape }): Promise<EPodResizeProbe> {
    return EPodResizeProbe.Unknown
  }
}
