import { ESandboxProvider } from '@dltech/atlas-protocol'
import {
  SandboxProvider,
  type DaemonEndpoint,
  type PodResizeOutcome,
  type SandboxCredentials,
  type SandboxListing,
  type SandboxTarget,
} from '../../../agent'
import type { V2PodFence, V2PodSweepScope } from './v2-pod-sweep'

export const NOW = new Date('2026-11-10T06:00:00Z')
export const hoursAgo = (hours: number): number => NOW.getTime() - hours * 60 * 60 * 1_000

export const AGENT37_CREDENTIALS: SandboxCredentials = {
  provider: ESandboxProvider.Agent37,
  apiKey: 'key',
}

export const listing = (args: {
  sandboxSessionId: string
  running?: boolean
  createdAt?: number
}): SandboxListing => ({
  sandboxSessionId: args.sandboxSessionId,
  running: args.running ?? false,
  createdAt: args.createdAt ?? hoursAgo(25),
})

export class FakeSandboxProvider extends SandboxProvider {
  readonly stopped: string[] = []
  readonly deleted: string[] = []
  readonly credentialsSeen: SandboxCredentials[] = []

  constructor(
    private readonly args: {
      listings?: readonly SandboxListing[]
      failList?: string
      failStop?: string
      failDelete?: string
    },
  ) {
    super()
  }

  async list(args: { credentials: SandboxCredentials }): Promise<readonly SandboxListing[]> {
    this.credentialsSeen.push(args.credentials)
    if (this.args.failList !== undefined) throw new Error(this.args.failList)
    return this.args.listings ?? []
  }

  async stop(args: { target: SandboxTarget }): Promise<void> {
    if (this.args.failStop !== undefined) throw new Error(this.args.failStop)
    this.stopped.push(args.target.sandboxSessionId)
  }

  async delete(args: { target: SandboxTarget }): Promise<void> {
    if (this.args.failDelete !== undefined) throw new Error(this.args.failDelete)
    this.deleted.push(args.target.sandboxSessionId)
  }

  async wake(): Promise<DaemonEndpoint> {
    throw new Error('the sweep never wakes a pod')
  }

  async keepAlive(): Promise<void> {
    throw new Error('the sweep never touches a deadline')
  }

  async resize(): Promise<PodResizeOutcome> {
    throw new Error('the sweep never resizes a pod')
  }
}

export const scope = (sandbox: SandboxProvider): V2PodSweepScope => ({
  label: 'platform/agent37',
  credentials: AGENT37_CREDENTIALS,
  sandbox,
})

export const noPods = { live: new Set<string>(), retirable: new Map<string, number>() }

export const actDirectly: V2PodFence = async ({ act }) => {
  await act()
  return 'acted'
}
