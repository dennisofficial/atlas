import { describe, expect, it } from 'bun:test'

import { ToolDispatcher, type DispatchArgs, type DispatchableCall } from '@dltech/atlas-agent'
import type { CallId, EventDraft, RunId, ThreadId } from '@dltech/atlas-core'
import { ECallStatus } from '@dltech/atlas-protocol'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { RemoteCalls, ScopedToolDispatcher, systemTimers } from '../..'
import { nextKey } from '../call-scope'

const SANDBOX = 'atlas-v2-pod-call-identity'
const SECRET = 'pod-call-identity-secret'
const SESSION = 's-pod-call-identity'

const call = (name: string): DispatchableCall => ({
  callId: `call-${name}` as CallId,
  name,
  input: {},
  runId: 'run-1' as RunId,
  threadId: 'thread-1' as ThreadId,
})

const dispatchArgs = (c: DispatchableCall): DispatchArgs => ({
  call: c,
  signal: new AbortController().signal,
  projectDirectory: '/tmp',
  events: [],
})

const callsOf = (daemon: Awaited<ReturnType<typeof createInMemoryDaemon>>): RemoteCalls =>
  new RemoteCalls({
    sessionId: SESSION,
    token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
    connector: () =>
      Promise.resolve((handlers) => Promise.resolve(daemon.connectRaw(handlers)) as Promise<never>),
    timers: systemTimers,
    onFenced: () => {},
  })

class ReadTool extends ToolDispatcher {
  constructor(private readonly calls: RemoteCalls) {
    super()
  }

  async dispatch(args: DispatchArgs): Promise<readonly EventDraft[]> {
    const result = await this.calls.invoke({ key: nextKey(), op: { op: 'stat', path: '/' } })
    expect(result.status).toBe(ECallStatus.Ok)
    return [{ type: 'tool-result', callId: args.call.callId, name: args.call.name, output: 'ok' }]
  }
}

describe('a tool that opens a pod call', () => {
  it('is known by its name, and the pod holds the call while its boot stays the same', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const calls = callsOf(daemon)
    calls.open({ epoch: 1 })
    await calls.ready()
    expect(calls.usesPodCall('service')).toBe(false)

    await new ScopedToolDispatcher(new ReadTool(calls)).dispatch(dispatchArgs(call('service')))

    expect(calls.usesPodCall('service')).toBe(true)
    expect(calls.usesPodCall('enter_worktree')).toBe(false)
    expect(await calls.holdsPodCall({ runId: 'run-1', callId: 'call-service' })).toBe(true)
    calls.close()
    await daemon.stop()

    const other = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const stranger = callsOf(other)
    stranger.open({ epoch: 1 })
    await stranger.ready()

    expect(await stranger.holdsPodCall({ runId: 'run-1', callId: 'call-service' })).toBe(false)

    stranger.close()
    await other.stop()
  }, 15_000)
})
