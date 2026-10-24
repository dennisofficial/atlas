import { describe, expect, it } from 'bun:test'

import type { PendingEntryWire, WireEvent } from '@dltech/atlas-wire/web'

import { clearedDraftOf, isHandedOff } from '../composer-handoff'

const said = (args: { seq: number; text: string; requestId?: string }): WireEvent => ({
  id: `evt_${args.seq}`,
  threadId: 'thr_1',
  seq: args.seq,
  runId: 'run_1',
  depth: 0,
  at: '2026-10-24T10:00:00.000Z',
  type: 'user-said',
  body: JSON.stringify({
    type: 'user-said',
    text: args.text,
    ...(args.requestId === undefined ? {} : { requestId: args.requestId }),
  }),
})

const queued = (text: string): PendingEntryWire => ({ id: 'p_1', text, reserved: false })

const handoff = { sendId: 'send_1', text: 'fix the build' }

describe('isHandedOff', () => {
  it('waits while neither the transcript nor the queue holds the message', () => {
    const events = [said({ seq: 1, text: 'fix the build', requestId: 'send_0' })]
    expect(isHandedOff({ handoff, events, pending: [] })).toBe(false)
  })

  it('settles once the transcript holds a user turn with the send id', () => {
    const events = [said({ seq: 1, text: 'fix the build', requestId: 'send_1' })]
    expect(isHandedOff({ handoff, events, pending: [] })).toBe(true)
  })

  it('settles once the message sits in the pending queue', () => {
    expect(isHandedOff({ handoff, events: [], pending: [queued('fix the build')] })).toBe(true)
  })
})

describe('clearedDraftOf', () => {
  it('clears the draft that still holds the sent text', () => {
    expect(clearedDraftOf({ current: 'fix the build', handoff })).toBe('')
  })

  it('keeps a draft the operator edited while the message was in flight', () => {
    expect(clearedDraftOf({ current: 'something else', handoff })).toBe('something else')
  })
})
