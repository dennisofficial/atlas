import { describe, expect, it } from 'bun:test'

import { ToolDispatcher, type DispatchArgs, type DispatchableCall } from '@dltech/atlas-agent'
import type { CallId, EventDraft, RunId, ThreadId } from '@dltech/atlas-core'
import { ECallStatus, type CallOp } from '@dltech/atlas-protocol'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { RemoteCalls, ScopedToolDispatcher, systemTimers } from '../..'
import { scopedOpKey } from '../call-scope'

const SANDBOX = 'atlas-v2-legacy-keys'
const SECRET = 'legacy-keys-secret'
const SESSION = 's-legacy-keys'
const SCOPE = 'run-1:call-1'

const OP: CallOp = { op: 'stat', path: '/' }

const call: DispatchableCall = {
  callId: 'call-1' as CallId,
  name: 'service',
  input: {},
  runId: 'run-1' as RunId,
  threadId: 'thread-1' as ThreadId,
}

const argsOf = (events: DispatchArgs['events']): DispatchArgs => ({
  call,
  signal: new AbortController().signal,
  projectDirectory: '/tmp',
  events,
})

class PluginLikeTool extends ToolDispatcher {
  readonly keys: string[] = []

  constructor(private readonly calls: RemoteCalls) {
    super()
  }

  async dispatch(args: DispatchArgs): Promise<readonly EventDraft[]> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const key = scopedOpKey(OP)
      this.keys.push(key)
      const result = await this.calls.invoke({ key, op: OP })
      expect(result.status).toBe(ECallStatus.Ok)
    }
    return [{ type: 'tool-result', callId: args.call.callId, name: args.call.name, output: 'ok' }]
  }
}

const daemonOf = async (): Promise<{
  daemon: Awaited<ReturnType<typeof createInMemoryDaemon>>
  calls: RemoteCalls
}> => {
  const daemon = await createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
  })
  const calls = new RemoteCalls({
    sessionId: SESSION,
    token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
    connector: () =>
      Promise.resolve((handlers) => Promise.resolve(daemon.connectRaw(handlers)) as Promise<never>),
    timers: systemTimers,
    onFenced: () => {},
  })
  calls.open({ epoch: 1 })
  await calls.ready()
  return { daemon, calls }
}

describe('a call an earlier holder dispatched without a boot identity', () => {
  it('replays the keys that holder used, so the pod runs each operation once', async () => {
    const { daemon, calls } = await daemonOf()
    await calls.invoke({ key: `${SCOPE}.0`, op: OP })
    await calls.invoke({ key: `${SCOPE}.1`, op: OP })
    const runsBefore = daemon.runCount()

    const tool = new PluginLikeTool(calls)
    await new ScopedToolDispatcher(tool).dispatch(
      argsOf([{ type: 'tool-dispatched', callId: call.callId, name: call.name }]),
    )

    expect(tool.keys).toEqual([`${SCOPE}.0`, `${SCOPE}.1`])
    expect(daemon.runCount()).toBe(runsBefore)

    calls.close()
    await daemon.stop()
  }, 15_000)

  it('starts fresh keys for a call dispatched after a boot was recorded', async () => {
    const { daemon, calls } = await daemonOf()

    const tool = new PluginLikeTool(calls)
    await new ScopedToolDispatcher(tool).dispatch(
      argsOf([{ type: 'tool-dispatched', callId: call.callId, name: call.name, bootId: 'boot-a' }]),
    )

    expect(tool.keys[0]).toMatch(/^run-1:call-1\.[0-9a-f]{12}\.0$/)
    expect(tool.keys[1]).toMatch(/^run-1:call-1\.[0-9a-f]{12}\.1$/)

    calls.close()
    await daemon.stop()
  }, 15_000)
})
