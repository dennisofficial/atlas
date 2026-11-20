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
} from '../../sandbox/sandbox-provider'
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

class RestartingPodSandbox extends SandboxProvider {
  wakes = 0
  reported: number[] = []

  constructor(private readonly sizes: readonly number[]) {
    super()
  }

  async wake(_args: { target: SandboxTarget; signal: AbortSignal }): Promise<DaemonEndpoint> {
    const vcpus = this.sizes[Math.min(this.wakes, this.sizes.length - 1)] ?? this.sizes[0]
    this.wakes += 1
    this.reported.push(vcpus ?? 0)
    // a dead url: the connector wakes again, the way it does when a resize restarted the container
    return { url: `ws://127.0.0.1:1/${this.wakes}`, token: 't', sandboxName: 'n', vcpus }
  }

  async stop(): Promise<void> {}
  async keepAlive(): Promise<void> {}

  async resize(_args: { target: SandboxTarget; vcpus: number }): Promise<PodResizeOutcome> {
    return 'restarted'
  }

  async delete(): Promise<void> {}

  async list(_args: { credentials: SandboxCredentials }): Promise<readonly SandboxListing[]> {
    return []
  }
}

type PodRow = { podDesiredVcpus: number | null; podSizeGeneration: number }

const sizingOf = (rows: Record<string, PodRow>) => {
  const recorded: { sessionId: string; vcpus: number; generation: number }[] = []
  return {
    recorded,
    podSizing: {
      recordPodApplied: async (args: { sessionId: string; vcpus: number; generation: number }) => {
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

const until = async (check: () => boolean): Promise<void> => {
  for (let index = 0; index < 400 && !check(); index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('recording the applied pod size', () => {
  it('records the size a resize wrote while the runtime was already built', async () => {
    const rows: Record<string, PodRow> = {
      'pod-a': { podDesiredVcpus: null, podSizeGeneration: 0 },
    }
    const { recorded, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([4, 2])
    const runtime = await build({ sandbox, podSizing })({
      sessionId: 'pod-a',
      podSessionId: 'pod-a',
      threadId: toThreadId('t-pod-a'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    // the resize lands after the runtime is built: 2 vCPU as generation 1 on the pod row
    rows['pod-a'] = { podDesiredVcpus: 2, podSizeGeneration: 1 }
    await until(() => recorded.length > 0)
    await runtime.stop()

    expect(sandbox.reported.slice(0, 2)).toEqual([4, 2])
    expect(recorded[0]).toEqual({ sessionId: 'pod-a', vcpus: 2, generation: 1 })
  })

  it('records on the pod row a sub-agent session shares', async () => {
    const rows: Record<string, PodRow> = { 'pod-a': { podDesiredVcpus: 2, podSizeGeneration: 1 } }
    const { recorded, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([2])
    const runtime = await build({ sandbox, podSizing })({
      sessionId: 'child-a',
      podSessionId: 'pod-a',
      threadId: toThreadId('t-child-a'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    await until(() => recorded.length > 0)
    await runtime.stop()

    expect(recorded[0]).toEqual({ sessionId: 'pod-a', vcpus: 2, generation: 1 })
  })

  it('records nothing when the sandbox came back at another size', async () => {
    const rows: Record<string, PodRow> = { 'pod-a': { podDesiredVcpus: 4, podSizeGeneration: 2 } }
    const { recorded, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([2])
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

  it('records nothing when nothing was ever asked for', async () => {
    const rows: Record<string, PodRow> = {
      'pod-a': { podDesiredVcpus: null, podSizeGeneration: 0 },
    }
    const { recorded, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([4])
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
})
