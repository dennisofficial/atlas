import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { SandboxUnavailableError, systemTimers, type HostTimers } from '@dltech/atlas-host'

import type { AgentHostConfig, ConfigSource } from '../../config/agent-host-config'
import type { VercelCredentials } from '../../sandbox/constants'
import { SandboxProvider, type DaemonEndpoint } from '../../sandbox/sandbox-provider'
import { createSessionRuntimeFactory } from '../session-runtime-factory'

const config: AgentHostConfig = {
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
}

const source: ConfigSource & { issue(): Promise<never> } = {
  read: async () => config,
  issue: async () => {
    throw new Error('unused')
  },
}

class DeadUrlSandbox extends SandboxProvider {
  wakes = 0
  rejectFrom = Number.POSITIVE_INFINITY

  async wake(_args: {
    sessionId: string
    credentials: VercelCredentials
    signal: AbortSignal
  }): Promise<DaemonEndpoint> {
    this.wakes += 1
    if (this.wakes >= this.rejectFrom) throw new Error('sandbox gone')
    return { url: `ws://127.0.0.1:1/${this.wakes}`, token: 't', sandboxName: 'n' }
  }

  async stop(): Promise<void> {}
  async keepAlive(): Promise<void> {}
}

const timers: HostTimers = { now: () => Date.now(), ...systemTimers, random: () => 0 }

const build = (sandbox: SandboxProvider) =>
  createSessionRuntimeFactory({
    config: source,
    tokens: source,
    github: { read: async () => null },
    sandbox,
    daemonSecret: 'secret-1',
    timers,
    modelFor: () => new ScriptedModel([{ text: 'done' }]),
  })

const until = async (check: () => boolean): Promise<void> => {
  for (let index = 0; index < 400 && !check(); index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('sandbox loss while held', () => {
  it('wakes the sandbox again when the endpoint keeps refusing connections', async () => {
    const sandbox = new DeadUrlSandbox()
    const runtime = await build(sandbox)({
      sessionId: 's-rewake',
      threadId: toThreadId('t-rewake'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    await until(() => sandbox.wakes >= 2)
    await runtime.stop()
    expect(sandbox.wakes).toBeGreaterThanOrEqual(2)
  })

  it('gives up with SandboxUnavailableError after a bounded number of wakes', async () => {
    const sandbox = new DeadUrlSandbox()
    sandbox.rejectFrom = 2
    const runtime = await build(sandbox)({
      sessionId: 's-rewake-bound',
      threadId: toThreadId('t-rewake-bound'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    const outcome = await runtime.remoteCalls.ready().then(
      () => 'resolved',
      (error: unknown) => error,
    )
    await runtime.stop()
    expect(outcome).toBeInstanceOf(SandboxUnavailableError)
  })
})
