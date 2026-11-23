import type { PodShape } from '@dltech/atlas-core'
import { EEffort, toThreadId } from '@dltech/atlas-core'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { systemTimers, type HostTimers } from '@dltech/atlas-host'

import type { AgentHostConfig, ConfigSource } from '../../config/agent-host-config'
import {
  SandboxProvider,
  type DaemonEndpoint,
  type PodResizeOutcome,
  type SandboxCredentials,
  type SandboxListing,
  type SandboxTarget,
} from '@dltech/atlas-pods/sandbox/sandbox-provider'
import { sandboxRegistryOf } from '@dltech/atlas-pods/sandbox/provider-registry'

import { singleProviderRegistry } from '../../testing/sandbox-registry'
import { fakeModelSourceOf } from '../../testing/model-source'
import { createSessionRuntimeFactory } from '../session-runtime-factory'

const MODEL = {
  configured: true as const,
  ref: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
  effort: EEffort.Medium,
  fast: false,
  accountId: 'acct-1',
  credential: { kind: 'api-key' as const, apiKey: 'sk-test' },
}

// the shape of a pod that was created at the workspace default and never resized: no podSize at all
const config: AgentHostConfig = {
  userId: 'user-1',
  projectId: 'proj-1',
  model: MODEL,
  models: fakeModelSourceOf(MODEL),
  sandbox: {
    configured: true,
    provider: ESandboxProvider.Vercel,
    credentials: {
      provider: ESandboxProvider.Vercel,
      token: 'vt',
      teamId: 'team',
      projectId: 'proj',
    },
    vcpus: 4,
  },
  workspace: { remoteUrl: null, baseBranch: null, additionalRepos: [], setupScript: '' },
  skills: [],
}

const source: ConfigSource = {
  read: async () => config,
  models: async () => config.models,
}

export const AGENT37_DISK_SOURCE: ConfigSource = {
  read: async () => ({
    ...config,
    sandbox: {
      configured: true,
      provider: ESandboxProvider.Agent37,
      credentials: { provider: ESandboxProvider.Agent37, apiKey: 'sk-test' },
      vcpus: 4,
      diskGb: 40,
    },
  }),
  models: async () => config.models,
}

export class RestartingPodSandbox extends SandboxProvider {
  wakes = 0
  reported: PodShape[] = []

  constructor(
    private readonly shapes: readonly PodShape[],
    private readonly diskGb: number | undefined = undefined,
  ) {
    super()
  }

  async wake(_args: { target: SandboxTarget; signal: AbortSignal }): Promise<DaemonEndpoint> {
    const shape = this.shapes[Math.min(this.wakes, this.shapes.length - 1)] ?? this.shapes[0]
    this.wakes += 1
    if (shape === undefined)
      return { url: `ws://127.0.0.1:1/${this.wakes}`, token: 't', sandboxName: 'n' }
    this.reported.push(shape)
    // a dead url: the connector wakes again, the way it does when a resize restarted the container
    return {
      url: `ws://127.0.0.1:1/${this.wakes}`,
      token: 't',
      sandboxName: 'n',
      vcpus: shape.vcpus,
      memoryGb: shape.memoryGb,
      ...(this.diskGb === undefined ? {} : { diskGb: this.diskGb }),
    }
  }

  async stop(): Promise<void> {}
  async keepAlive(): Promise<void> {}

  async resize(_args: { target: SandboxTarget; shape: PodShape }): Promise<PodResizeOutcome> {
    return 'restarted'
  }

  async delete(): Promise<void> {}

  async list(_args: { credentials: SandboxCredentials }): Promise<readonly SandboxListing[]> {
    return []
  }
}

export type PodRow = {
  podDesiredVcpus: number | null
  podDesiredMemoryGb: number | null
  podDesiredDiskGb: number | null
  podSizeGeneration: number
}

export const rowOf = (over: Partial<PodRow> = {}): PodRow => ({
  podDesiredVcpus: null,
  podDesiredMemoryGb: null,
  podDesiredDiskGb: null,
  podSizeGeneration: 0,
  ...over,
})

export const sizingOf = (rows: Record<string, PodRow>) => {
  const recorded: {
    sessionId: string
    vcpus: number
    memoryGb: number
    generation: number
  }[] = []
  const recordedDisks: { sessionId: string; diskGb: number }[] = []
  return {
    recorded,
    recordedDisks,
    podSizing: {
      recordPodApplied: async (args: {
        sessionId: string
        vcpus: number
        memoryGb: number
        generation: number
      }) => {
        const row = rows[args.sessionId]
        if (row === undefined || row.podSizeGeneration !== args.generation) return false
        recorded.push(args)
        return true
      },
      recordPodDisk: async (args: { sessionId: string; diskGb: number }) => {
        const row = rows[args.sessionId]
        if (row === undefined) return false
        recordedDisks.push(args)
        row.podDesiredDiskGb = args.diskGb
        return true
      },
      readSession: async (args: { sessionId: string }) => rows[args.sessionId],
    },
  }
}

const timers: HostTimers = { now: () => Date.now(), ...systemTimers, random: () => 0 }

export const build = (args: {
  sandbox: SandboxProvider
  podSizing: ReturnType<typeof sizingOf>['podSizing']
  config?: ConfigSource | undefined
}) =>
  createSessionRuntimeFactory({
    config: args.config ?? source,
    tokens: { issue: async () => Promise.reject(new Error('unused')) },
    github: { read: async () => null },
    sandbox:
      args.config === undefined
        ? singleProviderRegistry(args.sandbox)
        : sandboxRegistryOf(
            new Map([
              [ESandboxProvider.Vercel, args.sandbox],
              [ESandboxProvider.Agent37, args.sandbox],
            ]),
          ),
    daemonSecret: 'secret-1',
    timers,
    modelFor: () => new ScriptedModel([{ text: 'done' }]),
    podSizing: args.podSizing,
  })

export const startOf = (args: {
  sandbox: SandboxProvider
  podSizing: ReturnType<typeof sizingOf>['podSizing']
  config?: ConfigSource | undefined
}) =>
  build(args)({
    sessionId: 'pod-a',
    podSessionId: 'pod-a',
    threadId: toThreadId('t-pod-a'),
    epoch: 1,
    signal: new AbortController().signal,
  })

export const DISK_ROW = rowOf({
  podDesiredVcpus: 4,
  podDesiredMemoryGb: 16,
  podDesiredDiskGb: 30,
  podSizeGeneration: 1,
})

export const until = async (check: () => boolean): Promise<void> => {
  for (let index = 0; index < 400 && !check(); index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
