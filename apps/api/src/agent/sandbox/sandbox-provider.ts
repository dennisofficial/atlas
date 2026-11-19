import type { VercelCredentials } from './constants'

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

export const sandboxNameOf = (sandboxSessionId: string): string => `atlas-v2-${sandboxSessionId}`

export abstract class SandboxProvider {
  abstract wake(args: {
    sandboxSessionId: string
    credentials: VercelCredentials
    signal: AbortSignal
    vcpus?: number | undefined
  }): Promise<DaemonEndpoint>
  abstract stop(args: { sandboxSessionId: string; credentials: VercelCredentials }): Promise<void>
  abstract keepAlive(args: {
    sandboxSessionId: string
    credentials: VercelCredentials
    until: number
  }): Promise<void>
}
