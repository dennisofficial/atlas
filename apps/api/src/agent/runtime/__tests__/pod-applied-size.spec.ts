import type { PodShape } from '@dltech/atlas-core'
import { EEffort, toThreadId } from '@dltech/atlas-core'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { systemTimers, type HostTimers } from '@dltech/atlas-host'
import { describe, expect, it } from 'bun:test'

import type { AgentHostConfig, ConfigSource } from '../../config/agent-host-config'
import {
  SandboxProvider,
  type DaemonEndpoint,
  type PodResizeOutcome,
  type SandboxCredentials,
  type SandboxListing,
  type SandboxTarget,
} from '@dltech/atlas-pods/sandbox/sandbox-provider'
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
  classifier: { on: false, reason: 'no classifier model is set' },
  quality: { enabled: false, policies: {} },
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

class RestartingPodSandbox extends SandboxProvider {
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

type PodRow = {
  podDesiredVcpus: number | null
  podDesiredMemoryGb: number | null
  podDesiredDiskGb: number | null
  podSizeGeneration: number
}

const rowOf = (over: Partial<PodRow> = {}): PodRow => ({
  podDesiredVcpus: null,
  podDesiredMemoryGb: null,
  podDesiredDiskGb: null,
  podSizeGeneration: 0,
  ...over,
})

const sizingOf = (rows: Record<string, PodRow>) => {
  const recorded: {
    sessionId: string
    vcpus: number
    memoryGb: number
    generation: number
  }[] = []
  return {
    recorded,
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
      readSession: async (args: { sessionId: string }) => rows[args.sessionId],
    },
  }
}

const timers: HostTimers = { now: () => Date.now(), ...systemTimers, random: () => 0 }

const build = (args: {
  sandbox: SandboxProvider
  podSizing: ReturnType<typeof sizingOf>['podSizing']
}) =>
  createSessionRuntimeFactory({
    config: source,
    tokens: { issue: async () => Promise.reject(new Error('unused')) },
    github: { read: async () => null },
    sandbox: singleProviderRegistry(args.sandbox),
    daemonSecret: 'secret-1',
    timers,
    modelFor: () => new ScriptedModel([{ text: 'done' }]),
    podSizing: args.podSizing,
  })

const startOf = (args: {
  sandbox: SandboxProvider
  podSizing: ReturnType<typeof sizingOf>['podSizing']
}) =>
  build(args)({
    sessionId: 'pod-a',
    podSessionId: 'pod-a',
    threadId: toThreadId('t-pod-a'),
    epoch: 1,
    signal: new AbortController().signal,
  })

const DISK_ROW = rowOf({
  podDesiredVcpus: 4,
  podDesiredMemoryGb: 16,
  podDesiredDiskGb: 30,
  podSizeGeneration: 1,
})

const until = async (check: () => boolean): Promise<void> => {
  for (let index = 0; index < 400 && !check(); index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('recording the applied pod size', () => {
  it('records the size a resize wrote while the runtime was already built', async () => {
    const rows: Record<string, PodRow> = { 'pod-a': rowOf() }
    const { recorded, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([
      { vcpus: 4, memoryGb: 8 },
      { vcpus: 2, memoryGb: 4 },
    ])
    const runtime = await build({ sandbox, podSizing })({
      sessionId: 'pod-a',
      podSessionId: 'pod-a',
      threadId: toThreadId('t-pod-a'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    // the resize lands after the runtime is built: 2 vCPU as generation 1 on the pod row
    rows['pod-a'] = rowOf({ podDesiredVcpus: 2, podDesiredMemoryGb: 4, podSizeGeneration: 1 })
    await until(() => recorded.length > 0)
    await runtime.stop()

    expect(sandbox.reported.slice(0, 2)).toEqual([
      { vcpus: 4, memoryGb: 8 },
      { vcpus: 2, memoryGb: 4 },
    ])
    expect(recorded).toContainEqual({ sessionId: 'pod-a', vcpus: 2, memoryGb: 4, generation: 1 })
  })

  it('records the observed size of a pod that was never resized', async () => {
    const rows: Record<string, PodRow> = { 'pod-a': rowOf() }
    const { recorded, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([{ vcpus: 4, memoryGb: 8 }])
    const runtime = await build({ sandbox, podSizing })({
      sessionId: 'pod-a',
      podSessionId: 'pod-a',
      threadId: toThreadId('t-pod-a'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    await until(() => recorded.length > 0)
    await runtime.stop()

    expect(recorded[0]).toEqual({ sessionId: 'pod-a', vcpus: 4, memoryGb: 8, generation: 0 })
  })

  it('records on the pod row a sub-agent session shares', async () => {
    const rows: Record<string, PodRow> = {
      'pod-a': rowOf({ podDesiredVcpus: 2, podDesiredMemoryGb: 4, podSizeGeneration: 1 }),
    }
    const { recorded, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([{ vcpus: 2, memoryGb: 4 }])
    const runtime = await build({ sandbox, podSizing })({
      sessionId: 'child-a',
      podSessionId: 'pod-a',
      threadId: toThreadId('t-child-a'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    await until(() => recorded.length > 0)
    await runtime.stop()

    expect(recorded[0]).toEqual({ sessionId: 'pod-a', vcpus: 2, memoryGb: 4, generation: 1 })
  })

  it('records nothing when the sandbox came back at another size', async () => {
    const rows: Record<string, PodRow> = {
      'pod-a': rowOf({ podDesiredVcpus: 4, podDesiredMemoryGb: 8, podSizeGeneration: 2 }),
    }
    const { recorded, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([{ vcpus: 2, memoryGb: 4 }])
    const runtime = await build({ sandbox, podSizing })({
      sessionId: 'pod-a',
      podSessionId: 'pod-a',
      threadId: toThreadId('t-pod-a'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    await until(() => sandbox.wakes >= 3)
    await runtime.stop()

    expect(recorded).toEqual([])
  })

  it('records nothing when the sandbox came back at the cpu count but another memory', async () => {
    const rows: Record<string, PodRow> = {
      'pod-a': rowOf({ podDesiredVcpus: 4, podDesiredMemoryGb: 32, podSizeGeneration: 2 }),
    }
    const { recorded, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([{ vcpus: 4, memoryGb: 8 }])
    const runtime = await build({ sandbox, podSizing })({
      sessionId: 'pod-a',
      podSessionId: 'pod-a',
      threadId: toThreadId('t-pod-a'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    await until(() => sandbox.wakes >= 3)
    await runtime.stop()

    expect(recorded).toEqual([])
  })

  it('records a resize that grew the disk only once the pod reports the bigger disk', async () => {
    const rows: Record<string, PodRow> = { 'pod-a': DISK_ROW }
    const { recorded, podSizing } = sizingOf(rows)
    const small = new RestartingPodSandbox([{ vcpus: 4, memoryGb: 16 }], 20)
    const first = await startOf({ sandbox: small, podSizing })
    await until(() => small.wakes >= 3)
    await first.stop()
    expect(recorded).toEqual([])

    const grown = new RestartingPodSandbox([{ vcpus: 4, memoryGb: 16 }], 30)
    const second = await startOf({ sandbox: grown, podSizing })
    await until(() => recorded.length > 0)
    await second.stop()
    expect(recorded).toContainEqual({ sessionId: 'pod-a', vcpus: 4, memoryGb: 16, generation: 1 })
  })
})
