import { describe, expect, it } from 'bun:test'

import { ToolDispatcher, type DispatchArgs, type DispatchableCall } from '@dltech/atlas-agent'
import type { EventDraft, CallId, RunId, ThreadId } from '@dltech/atlas-core'

import { ScopedToolDispatcher, nextKey, runInCallScope, scopeKeyOf } from '../call-scope'

const call = (args: { runId: string; callId: string }): DispatchableCall => ({
  callId: args.callId as CallId,
  name: 'bash',
  input: {},
  runId: args.runId as RunId,
  threadId: 'thread-1' as ThreadId,
})

const dispatchArgs = (c: DispatchableCall): DispatchArgs => ({
  call: c,
  signal: new AbortController().signal,
  projectDirectory: '/tmp',
  events: [],
})

class RecordingDispatcher extends ToolDispatcher {
  keys: string[] = []
  async dispatch(_args: DispatchArgs): Promise<readonly EventDraft[]> {
    this.keys.push(nextKey(), nextKey())
    return []
  }
}

describe('scopeKeyOf', () => {
  it('joins run and call ids, hashing a call id that fails the key schema', () => {
    expect(scopeKeyOf({ runId: 'run-1', callId: 'call_2' })).toBe('run-1:call_2')
    const hashed = scopeKeyOf({ runId: 'run-1', callId: 'call with spaces' })
    expect(hashed).toMatch(/^run-1:h[0-9a-f]{16}$/)
  })
})

describe('nextKey', () => {
  it('numbers keys inside a scope and falls back to a uuid outside one', () => {
    runInCallScope({
      scopeKey: 'run-1:call_2',
      body: () => {
        expect(nextKey()).toBe('run-1:call_2.0')
        expect(nextKey()).toBe('run-1:call_2.1')
      },
    })
    expect(nextKey()).toMatch(/^host-[0-9a-f-]{36}$/)
  })
})

describe('ScopedToolDispatcher', () => {
  it('replays the same key sequence for two dispatches of one call', async () => {
    const inner = new RecordingDispatcher()
    const scoped = new ScopedToolDispatcher(inner)
    await scoped.dispatch(dispatchArgs(call({ runId: 'run-1', callId: 'call-1' })))
    await scoped.dispatch(dispatchArgs(call({ runId: 'run-1', callId: 'call-1' })))
    expect(inner.keys).toEqual([
      'run-1:call-1.0',
      'run-1:call-1.1',
      'run-1:call-1.0',
      'run-1:call-1.1',
    ])
  })

  it('never shares a key between two concurrent calls', async () => {
    const inner = new RecordingDispatcher()
    const scoped = new ScopedToolDispatcher(inner)
    await Promise.all([
      scoped.dispatch(dispatchArgs(call({ runId: 'run-1', callId: 'call-a' }))),
      scoped.dispatch(dispatchArgs(call({ runId: 'run-1', callId: 'call-b' }))),
    ])
    expect(new Set(inner.keys).size).toBe(inner.keys.length)
  })
})
