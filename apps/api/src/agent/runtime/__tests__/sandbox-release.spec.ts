import { EEffort, toThreadId } from '@dltech/atlas-core'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import { singleProviderRegistry } from '../../testing/sandbox-registry'
import { describe, expect, it } from 'bun:test'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { systemTimers } from '@dltech/atlas-host'

import type { AgentHostConfig, ConfigSource } from '../../config/agent-host-config'
import {
  SandboxProvider,
  type DaemonEndpoint,
  type SandboxTarget,
} from '../../sandbox/sandbox-provider'
import { createSessionRuntimeFactory } from '../session-runtime-factory'
import { fakeModelSourceOf } from '../../testing/model-source'

const config: AgentHostConfig = {
  userId: 'user-1',
  projectId: 'proj-1',
  model: {
    configured: true,
    ref: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
    effort: EEffort.Medium,
    fast: false,
    accountId: 'acct-1',
    credential: { kind: 'api-key', apiKey: 'sk-test' },
  },
  models: fakeModelSourceOf({
    configured: true,
    ref: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
    effort: EEffort.Medium,
    fast: false,
    accountId: 'acct-1',
    credential: { kind: 'api-key', apiKey: 'sk-test' },
  }),
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

const source: ConfigSource & { issue(): Promise<never> } = {
  read: async () => config,
  models: async () => config.models,
  issue: async () => {
    throw new Error('unused')
  },
}

class SlowWakeSandbox extends SandboxProvider {
  stopped: string[] = []

  wake(_args: { target: SandboxTarget; signal: AbortSignal }): Promise<DaemonEndpoint> {
    return new Promise(() => {})
  }

  async stop(args: { target: SandboxTarget }): Promise<void> {
    this.stopped.push(args.target.sandboxSessionId)
  }

  async keepAlive(): Promise<void> {}

  async resize(): Promise<void> {}
}

const releaseOf = async (args: {
  sessionId: string
  podSessionId: string
  placed: number
  asked: { podSessionId: string; excludeSessionId: string }[]
}): Promise<string[]> => {
  const sandbox = new SlowWakeSandbox()
  const factory = createSessionRuntimeFactory({
    config: source,
    tokens: source,
    github: { read: async () => null },
    sandbox: singleProviderRegistry(sandbox),
    daemonSecret: 'secret-1',
    timers: { now: () => Date.now(), ...systemTimers },
    podPeers: {
      placed: async (params) => {
        args.asked.push(params)
        return args.placed
      },
    },
    modelFor: () => new ScriptedModel([{ text: 'done' }]),
  })
  const runtime = await factory({
    sessionId: args.sessionId,
    podSessionId: args.podSessionId,
    threadId: toThreadId('t-release'),
    epoch: 1,
    signal: new AbortController().signal,
  })
  await runtime.release()
  return sandbox.stopped
}

describe('releasing a session sandbox', () => {
  it('leaves the pod to its sandbox deadline while another session is placed on it', async () => {
    const asked: { podSessionId: string; excludeSessionId: string }[] = []
    const stopped = await releaseOf({
      sessionId: 'peer-1',
      podSessionId: 'spawner',
      placed: 1,
      asked,
    })
    expect(stopped).toEqual([])
    expect(asked).toEqual([{ podSessionId: 'spawner', excludeSessionId: 'peer-1' }])
  })

  it('stops the pod when no other session is placed on it', async () => {
    const stopped = await releaseOf({
      sessionId: 'peer-2',
      podSessionId: 'spawner',
      placed: 0,
      asked: [],
    })
    expect(stopped).toEqual(['spawner'])
  })
})
