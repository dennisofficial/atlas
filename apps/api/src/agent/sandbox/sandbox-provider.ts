import { ESandboxProvider } from '@dltech/atlas-protocol'

import type { VercelCredentials } from './constants'

export type SandboxCredentials =
  | { provider: ESandboxProvider.Vercel; token: string; teamId: string; projectId: string }
  | { provider: ESandboxProvider.Agent37; apiKey: string }

export type SandboxTarget = { sandboxSessionId: string; credentials: SandboxCredentials }

export type DaemonEndpoint = {
  url: string
  token: string
  sandboxName: string
  vcpus?: number | undefined
}

export type PodResizeOutcome = 'restarted' | 'stored' | 'absent'

/** Stores a pod's size on the provider and restarts a running pod so it comes back at that size. */
export abstract class PodSizer {
  abstract resize(args: {
    sandboxSessionId: string
    credentials: VercelCredentials
    vcpus: number
  }): Promise<PodResizeOutcome>
}

export abstract class SandboxProvider {
  abstract wake(args: {
    target: SandboxTarget
    signal: AbortSignal
    vcpus?: number | undefined
  }): Promise<DaemonEndpoint>
  abstract stop(args: { target: SandboxTarget }): Promise<void>
  abstract keepAlive(args: { target: SandboxTarget; until: number }): Promise<void>
  abstract resize(args: { target: SandboxTarget; vcpus: number }): Promise<PodResizeOutcome>
}
