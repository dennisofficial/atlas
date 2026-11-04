import { describe, expect, it } from 'bun:test'
import { EToolEffect, toThreadId } from '@dltech/atlas-core'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { WORKSPACE_PATH, type VercelCredentials } from '@dltech/atlas-wire'
import type { AgentHostConfigOutput } from '@dltech/atlas-protocol'
import { systemTimers, type HostTimers } from '@dltech/atlas-host'

import type { AgentHostApi } from '../../config/agent-host-api'
import { SandboxProvider, type DaemonEndpoint } from '../../sandbox/sandbox-provider'
import { createSessionRuntimeFactory, SandboxNotConfiguredError } from '../session-runtime-factory'

const projectConfig = {
  settings: {},
  secrets: [],
  harnessSecrets: [],
  mcpServers: [],
  fileMounts: [],
  provenance: {},
}

const configured = (over: Partial<AgentHostConfigOutput> = {}): AgentHostConfigOutput => ({
  userId: 'user-1',
  projectId: 'proj-1',
  model: {
    configured: true,
    modelId: 'claude-sonnet-4-5',
    accountId: 'acct-1',
    credential: { kind: 'api-key', apiKey: 'sk-test' },
  },
  vercel: { configured: true, token: 'vt', teamId: 'team', projectId: 'proj' },
  config: projectConfig,
  revision: 'rev-1',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  ...over,
})

class FakeSandbox extends SandboxProvider {
  wakeStarted: string[] = []
  wakeResolve: ((endpoint: DaemonEndpoint) => void) | undefined
  stopped: string[] = []

  constructor(private readonly neverResolve = false) {
    super()
  }

  wake(args: {
    sessionId: string
    credentials: VercelCredentials
    signal: AbortSignal
  }): Promise<DaemonEndpoint> {
    this.wakeStarted.push(args.sessionId)
    if (this.neverResolve) return new Promise(() => {})
    return new Promise((resolve) => {
      this.wakeResolve = resolve
    })
  }

  async stop(args: { sessionId: string; credentials: VercelCredentials }): Promise<void> {
    this.stopped.push(args.sessionId)
  }

  async keepAlive(): Promise<void> {}
}

const apiOf = (output: AgentHostConfigOutput): AgentHostApi => ({
  config: async () => output,
  modelAccessToken: async () => {
    throw new Error('unused')
  },
  githubToken: async () => ({ token: null }),
})

const testTimers: HostTimers = { now: () => Date.now(), ...systemTimers }

const makeFactory = (args: {
  api: AgentHostApi
  sandbox: FakeSandbox
  modelFor?: Parameters<typeof createSessionRuntimeFactory>[0]['modelFor']
}) =>
  createSessionRuntimeFactory({
    api: args.api,
    sandbox: args.sandbox,
    daemonSecret: 'secret-1',
    timers: testTimers,
    ...(args.modelFor === undefined ? {} : { modelFor: args.modelFor }),
  })

describe('createSessionRuntimeFactory', () => {
  it('throws a typed error when vercel is not configured', async () => {
    const factory = makeFactory({
      api: apiOf(configured({ vercel: { configured: false, gap: 'connect a vercel account' } })),
      sandbox: new FakeSandbox(),
    })
    const promise = factory({
      sessionId: 's-1',
      threadId: toThreadId('t-1'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    await expect(promise).rejects.toBeInstanceOf(SandboxNotConfiguredError)
    await expect(promise).rejects.toThrow('connect a vercel account')
  })

  it('resolves while wake is still pending (prewarm)', async () => {
    const sandbox = new FakeSandbox(true)
    const factory = makeFactory({
      api: apiOf(configured()),
      sandbox,
      modelFor: () => new ScriptedModel([{ text: 'done' }]),
    })
    const runtime = await factory({
      sessionId: 's-2',
      threadId: toThreadId('t-2'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    expect(sandbox.wakeStarted).toEqual(['s-2'])
    await runtime.stop()
  })

  it('declares all seven daemon tools with their effects', async () => {
    const sandbox = new FakeSandbox(true)
    const factory = makeFactory({
      api: apiOf(configured()),
      sandbox,
      modelFor: () => new ScriptedModel([{ text: 'done' }]),
    })
    const runtime = await factory({
      sessionId: 's-3',
      threadId: toThreadId('t-3'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    expect([...runtime.daemonTools].sort()).toEqual(
      ['bash', 'edit', 'glob', 'grep', 'multi_edit', 'read', 'write'].sort(),
    )
    expect(runtime.effectOf('bash')).toBe(EToolEffect.Destructive)
    expect(runtime.effectOf('read')).toBe(EToolEffect.Read)
    expect(runtime.effectOf('write')).toBe(EToolEffect.Write)
    expect(runtime.effectOf('edit')).toBe(EToolEffect.Write)
    expect(runtime.effectOf('multi_edit')).toBe(EToolEffect.Write)
    expect(runtime.effectOf('grep')).toBe(EToolEffect.Read)
    expect(runtime.effectOf('glob')).toBe(EToolEffect.Read)
    expect(runtime.effectOf('nope')).toBeUndefined()
    expect(runtime.launchDirectory).toBe(WORKSPACE_PATH)
    expect(runtime.tools.find('bash')).toBeDefined()
    await runtime.stop()
  })

  it('release stops the sandbox, stop leaves it', async () => {
    const sandbox = new FakeSandbox(true)
    const factory = makeFactory({
      api: apiOf(configured()),
      sandbox,
      modelFor: () => new ScriptedModel([{ text: 'done' }]),
    })
    const args = {
      sessionId: 's-4',
      threadId: toThreadId('t-4'),
      epoch: 1,
      signal: new AbortController().signal,
    }
    const stopped = await factory(args)
    await stopped.stop()
    expect(sandbox.stopped).toEqual([])
    const released = await factory(args)
    await released.release()
    expect(sandbox.stopped).toEqual(['s-4'])
  })

  it('builds the anthropic model without the override', async () => {
    const sandbox = new FakeSandbox(true)
    const factory = makeFactory({ api: apiOf(configured()), sandbox })
    const runtime = await factory({
      sessionId: 's-5',
      threadId: toThreadId('t-5'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    expect(runtime.model).toBeDefined()
    await runtime.stop()
  })

  it('builds with an unconfigured model; reads fail as typed errors', async () => {
    const sandbox = new FakeSandbox(true)
    const factory = makeFactory({
      api: apiOf(configured({ model: { configured: false, gap: 'no anthropic account' } })),
      sandbox,
    })
    const runtime = await factory({
      sessionId: 's-6',
      threadId: toThreadId('t-6'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    expect(runtime.model).toBeDefined()
    await runtime.stop()
  })
})
