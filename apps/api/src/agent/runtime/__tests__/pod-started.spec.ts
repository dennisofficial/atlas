import { describe, expect, it } from 'bun:test'

import { EEffort, toThreadId, type PodShape } from '@dltech/atlas-core'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { systemTimers, type HostTimers } from '@dltech/atlas-host'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import {
  EPodStart,
  SandboxProvider,
  type DaemonEndpoint,
  type PodResizeOutcome,
  type SandboxCredentials,
  type SandboxListing,
  type SandboxTarget,
} from '@dltech/atlas-pods/sandbox/sandbox-provider'
import type { ProductAnalytics } from '@dltech/atlas-observability'

import type { AgentHostConfig, ConfigSource } from '../../config/agent-host-config'
import { fakeModelSourceOf } from '../../testing/model-source'
import { singleProviderRegistry } from '../../testing/sandbox-registry'
import { createSessionRuntimeFactory } from '../session-runtime-factory'

const MODEL = {
  configured: true as const,
  ref: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
  effort: EEffort.Medium,
  fast: false,
  accountId: 'acct-1',
  credential: { kind: 'api-key' as const, apiKey: 'sk-test' },
}

const config: AgentHostConfig = {
  userId: 'user-1',
  projectId: 'proj-1',
  model: MODEL,
  models: fakeModelSourceOf(MODEL),
  classifier: { on: false, reason: 'no classifier model is set' },
  rotation: { autoRotateAtPercent: 85 },
  sandbox: {
    configured: true,
    provider: ESandboxProvider.Vercel,
    credentials: {
      provider: ESandboxProvider.Vercel,
      token: 'vt',
      teamId: 'team',
      projectId: 'proj',
    },
  },
  workspace: { remoteUrl: null, baseBranch: null, additionalRepos: [], setupScript: '' },
  skills: [],
}

const source: ConfigSource = {
  read: async () => config,
  models: async () => config.models,
}

type Captured = { userId: string; event: string; properties?: Record<string, unknown> }

const recorderOf = () => {
  const captured: Captured[] = []
  const analytics: ProductAnalytics = {
    capture: (event) => {
      captured.push(event)
    },
    flush: async () => undefined,
  }
  return { captured, analytics }
}

class StartingPodSandbox extends SandboxProvider {
  wakes = 0

  constructor(private readonly args: { start: EPodStart; stages?: DaemonEndpoint['stages'] }) {
    super()
  }

  async wake(_args: { target: SandboxTarget; signal: AbortSignal }): Promise<DaemonEndpoint> {
    this.wakes += 1
    return {
      url: `ws://127.0.0.1:1/${this.wakes}`,
      token: 't',
      sandboxName: 'n',
      vcpus: 2,
      memoryGb: 4,
      start: this.args.start,
      stages: this.args.stages,
    }
  }

  async stop(): Promise<void> {}
  async keepAlive(): Promise<void> {}

  async resize(_args: { target: SandboxTarget; shape: PodShape }): Promise<PodResizeOutcome> {
    return 'unchanged'
  }

  async delete(): Promise<void> {}

  async list(_args: { credentials: SandboxCredentials }): Promise<readonly SandboxListing[]> {
    return []
  }
}

const timers: HostTimers = { now: () => Date.now(), ...systemTimers, random: () => 0 }

const startOf = async (args: { sandbox: SandboxProvider; analytics: ProductAnalytics }) =>
  createSessionRuntimeFactory({
    config: source,
    tokens: { issue: async () => Promise.reject(new Error('unused')) },
    github: { read: async () => null },
    sandbox: singleProviderRegistry(args.sandbox),
    daemonSecret: 'secret-1',
    timers,
    modelFor: () => new ScriptedModel([{ text: 'done' }]),
    analytics: args.analytics,
  })({
    sessionId: 'pod-a',
    podSessionId: 'pod-a',
    threadId: toThreadId('t-pod-a'),
    epoch: 1,
    signal: new AbortController().signal,
  })

const until = async (check: () => boolean): Promise<void> => {
  for (let index = 0; index < 400 && !check(); index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('pod_started', () => {
  it('reports a pod the wake created, with its provider, its session and how long the wake took', async () => {
    const { captured, analytics } = recorderOf()
    const sandbox = new StartingPodSandbox({ start: EPodStart.Created })
    const runtime = await startOf({ sandbox, analytics })
    await until(() => captured.length > 0)
    await runtime.stop()

    expect(captured[0]).toEqual({
      userId: 'user-1',
      event: 'pod_started',
      properties: {
        reason: EPodStart.Created,
        provider: ESandboxProvider.Vercel,
        session_id: 'pod-a',
        wake_ms: expect.any(Number),
      },
    })
  })

  it('forwards provider wake stages through the runtime lifecycle capture', async () => {
    const { captured, analytics } = recorderOf()
    const sandbox = new StartingPodSandbox({
      start: EPodStart.Woke,
      stages: { instanceStartMs: 1_234, daemonReadyMs: 2_345 },
    })
    const runtime = await startOf({ sandbox, analytics })
    await until(() => captured.length > 0)
    await runtime.stop()
    expect(captured[0]?.properties).toMatchObject({
      instance_start_ms: 1_234,
      daemon_ready_ms: 2_345,
    })
  })

  it('stays quiet for a pod that was already running', async () => {
    const { captured, analytics } = recorderOf()
    const sandbox = new StartingPodSandbox({ start: EPodStart.Running })
    const runtime = await startOf({ sandbox, analytics })
    await until(() => sandbox.wakes >= 2)
    await runtime.stop()

    expect(captured).toEqual([])
  })
})
