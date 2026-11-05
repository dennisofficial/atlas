import { describe, expect, it, spyOn } from 'bun:test'
import { EToolEffect, toThreadId } from '@dltech/atlas-core'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { WORKSPACE_PATH, type VercelCredentials } from '../../sandbox/constants'
import {
  RemoteCalls,
  SandboxUnavailableError,
  systemTimers,
  type HostTimers,
} from '@dltech/atlas-host'

import type { AgentHostConfig, ConfigSource } from '../../config/agent-host-config'
import { SandboxProvider, type DaemonEndpoint } from '../../sandbox/sandbox-provider'
import { createSessionRuntimeFactory, SandboxNotConfiguredError } from '../session-runtime-factory'

const configured = (over: Partial<AgentHostConfig> = {}): AgentHostConfig => ({
  userId: 'user-1',
  projectId: 'proj-1',
  model: {
    configured: true,
    modelId: 'claude-sonnet-4-5',
    accountId: 'acct-1',
    credential: { kind: 'api-key', apiKey: 'sk-test' },
  },
  vercel: { configured: true, token: 'vt', teamId: 'team', projectId: 'proj' },
  workspace: { remoteUrl: null, baseBranch: null, additionalRepos: [], setupScript: '' },
  skills: [],
  ...over,
})

class FakeSandbox extends SandboxProvider {
  wakeStarted: string[] = []
  wakeResolve: ((endpoint: DaemonEndpoint) => void) | undefined
  stopped: string[] = []
  keptAlive: string[] = []

  constructor(
    private readonly neverResolve = false,
    private readonly rejectWake = false,
  ) {
    super()
  }

  wake(args: {
    sessionId: string
    credentials: VercelCredentials
    signal: AbortSignal
  }): Promise<DaemonEndpoint> {
    this.wakeStarted.push(args.sessionId)
    if (this.rejectWake) return Promise.reject(new Error('daemon bundle missing'))
    if (this.neverResolve) return new Promise(() => {})
    return new Promise((resolve) => {
      this.wakeResolve = resolve
    })
  }

  async stop(args: { sessionId: string; credentials: VercelCredentials }): Promise<void> {
    this.stopped.push(args.sessionId)
  }

  async keepAlive(args: { sessionId: string }): Promise<void> {
    this.keptAlive.push(args.sessionId)
  }
}

type ScheduledTimer = { handler: () => void; cleared: boolean }

const makeFakeTimers = (): { timers: HostTimers; fireScheduled: () => void } => {
  const scheduled: ScheduledTimer[] = []
  const timers: HostTimers = {
    now: () => Date.now(),
    setTimeout: (handler) => {
      const timer: ScheduledTimer = { handler, cleared: false }
      scheduled.push(timer)
      return timer
    },
    clearTimeout: (timer) => {
      ;(timer as ScheduledTimer).cleared = true
    },
    random: () => 0,
  }
  return {
    timers,
    fireScheduled: () => {
      for (const timer of [...scheduled]) {
        if (!timer.cleared) timer.handler()
      }
    },
  }
}

const apiOf = (output: AgentHostConfig): ConfigSource & { issue(): Promise<never> } => ({
  read: async () => output,
  issue: async () => {
    throw new Error('unused')
  },
})

const testTimers: HostTimers = { now: () => Date.now(), ...systemTimers }

const makeFactory = (args: {
  api: ConfigSource & { issue(): Promise<never> }
  sandbox: FakeSandbox
  modelFor?: Parameters<typeof createSessionRuntimeFactory>[0]['modelFor']
}) =>
  createSessionRuntimeFactory({
    config: args.api,
    tokens: args.api,
    github: { read: async () => null },
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

  it('surfaces a wake rejection to ready() and a waiting dispatch', async () => {
    const sandbox = new FakeSandbox(false, true)
    const factory = makeFactory({
      api: apiOf(configured()),
      sandbox,
      modelFor: () => new ScriptedModel([{ text: 'done' }]),
    })
    const runtime = await factory({
      sessionId: 's-wake-fail',
      threadId: toThreadId('t-wake-fail'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    const hung = new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 2_000))
    const ready = runtime.remoteCalls.ready().then(
      () => 'resolved',
      (error: unknown) => error,
    )
    const readyOutcome = await Promise.race([ready, hung])
    const dispatch = runtime.remoteCalls.invoke({ key: 'k1', op: { op: 'stat', path: '/x' } }).then(
      () => 'resolved',
      (error: unknown) => error,
    )
    const dispatchOutcome = await Promise.race([dispatch, hung])
    await runtime.stop()
    expect(readyOutcome).toBeInstanceOf(SandboxUnavailableError)
    expect(dispatchOutcome).toBeInstanceOf(SandboxUnavailableError)
  })

  it('stops the keep-alive when the session lifetime ends without stop()', async () => {
    const { timers, fireScheduled } = makeFakeTimers()
    const sandbox = new FakeSandbox(true)
    const factory = createSessionRuntimeFactory({
      config: apiOf(configured()),
      tokens: apiOf(configured()),
      github: { read: async () => null },
      sandbox,
      daemonSecret: 'secret-1',
      timers,
      modelFor: () => new ScriptedModel([{ text: 'done' }]),
    })
    const lifetime = new AbortController()
    await factory({
      sessionId: 's-keep-alive',
      threadId: toThreadId('t-keep-alive'),
      epoch: 1,
      signal: lifetime.signal,
    })
    lifetime.abort()
    fireScheduled()
    expect(sandbox.keptAlive).toEqual([])
  })

  it('never arms the keep-alive when the lifetime already ended', async () => {
    const { timers, fireScheduled } = makeFakeTimers()
    const sandbox = new FakeSandbox(true)
    const factory = createSessionRuntimeFactory({
      config: apiOf(configured()),
      tokens: apiOf(configured()),
      github: { read: async () => null },
      sandbox,
      daemonSecret: 'secret-1',
      timers,
      modelFor: () => new ScriptedModel([{ text: 'done' }]),
    })
    const lifetime = new AbortController()
    lifetime.abort()
    await factory({
      sessionId: 's-aborted',
      threadId: toThreadId('t-aborted'),
      epoch: 1,
      signal: lifetime.signal,
    })
    fireScheduled()
    expect(sandbox.keptAlive).toEqual([])
  })

  it('closes the daemon link when the model override throws', async () => {
    const closeSpy = spyOn(RemoteCalls.prototype, 'close')
    try {
      const sandbox = new FakeSandbox(true)
      const factory = makeFactory({
        api: apiOf(configured()),
        sandbox,
        modelFor: () => {
          throw new Error('no model')
        },
      })
      await expect(
        factory({
          sessionId: 's-model',
          threadId: toThreadId('t-model'),
          epoch: 1,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow('no model')
      expect(closeSpy).toHaveBeenCalledTimes(1)
    } finally {
      closeSpy.mockRestore()
    }
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
