import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  EInputConsumed,
  toRunId,
  toThreadId,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { createWithdrawStore } from '../withdraw-store'
import { ALREADY_SENT_NOTICE, type WithdrawIntent } from '../withdraw-queue'

const eventsOf = (bodies: readonly RecordEventBody[]): readonly RecordEvent[] =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-25T10:00:00.000Z',
    from: undefined,
    bodies,
  })

const POSTED: RecordEventBody = {
  type: 'input-posted',
  inboxId: 4,
  kind: 'message',
  postedAt: '2026-11-25T10:00:00.000Z',
  message: { text: 'ship it' },
}

const WITHDRAWN: RecordEventBody = { type: 'input-withdrawn', inboxId: 4 }

const CONSUMED: RecordEventBody = {
  type: 'input-consumed',
  inboxId: 4,
  consumed: EInputConsumed.Message,
}

const REFUSED: RecordEventBody = {
  type: 'input-refused',
  inboxId: 9,
  targetInboxId: 4,
  reason: 'already-sent',
}

const intent: WithdrawIntent = { sessionId: 'ses-1', targetInboxId: 4 }

describe('the withdraw store', () => {
  it('records one intent per target', () => {
    const store = createWithdrawStore()
    expect(store.request(intent)).toBe(true)
    expect(store.request(intent)).toBe(false)
    expect(store.intentsOf('ses-1')).toEqual([intent])
  })

  it('settles each target at most once', () => {
    const store = createWithdrawStore()
    store.request(intent)
    const settled = eventsOf([POSTED, WITHDRAWN])
    expect(store.takeSettlements({ sessionId: 'ses-1', events: settled })).toEqual([
      { targetInboxId: 4, status: 'withdrawn' },
    ])
    expect(store.takeSettlements({ sessionId: 'ses-1', events: settled })).toEqual([])
  })

  it('forgets an intent once settled', () => {
    const store = createWithdrawStore()
    store.request(intent)
    store.takeSettlements({ sessionId: 'ses-1', events: eventsOf([POSTED, REFUSED]) })
    expect(store.intentsOf('ses-1')).toEqual([])
  })

  it('drops a refused intent so the row comes back', () => {
    const store = createWithdrawStore()
    store.request(intent)
    store.discard(intent)
    expect(store.intentsOf('ses-1')).toEqual([])
    expect(store.holds(intent)).toBe(false)
  })

  it('keeps an unanswered intent after its target leaves the queue', () => {
    const store = createWithdrawStore()
    store.request(intent)
    const settled = store.takeSettlements({
      sessionId: 'ses-1',
      events: eventsOf([POSTED, CONSUMED]),
    })
    expect(settled).toEqual([])
    expect(store.intentsOf('ses-1')).toEqual([intent])
  })

  it('refuses a target that left the queue before the refusal arrived', () => {
    const store = createWithdrawStore()
    store.request(intent)
    store.takeSettlements({ sessionId: 'ses-1', events: eventsOf([POSTED, CONSUMED]) })
    expect(
      store.takeSettlements({ sessionId: 'ses-1', events: eventsOf([POSTED, CONSUMED, REFUSED]) }),
    ).toEqual([{ targetInboxId: 4, status: 'refused', notice: ALREADY_SENT_NOTICE }])
    expect(store.intentsOf('ses-1')).toEqual([])
  })

  it('settles an intent for one session and never another', () => {
    const store = createWithdrawStore()
    const other: WithdrawIntent = { sessionId: 'ses-2', targetInboxId: 4 }
    store.request(intent)
    store.request(other)
    store.takeSettlements({ sessionId: 'ses-1', events: eventsOf([POSTED, WITHDRAWN]) })
    expect(store.intentsOf('ses-1')).toEqual([])
    expect(store.intentsOf('ses-2')).toEqual([other])
  })

  it('tells only the listeners of the session that changed', () => {
    const store = createWithdrawStore()
    let first = 0
    let second = 0
    store.subscribe({ sessionId: 'ses-1', listener: () => (first += 1) })
    store.subscribe({ sessionId: 'ses-2', listener: () => (second += 1) })
    store.request(intent)
    expect([first, second]).toEqual([1, 0])
  })

  it('keeps the same snapshot until the session changes', () => {
    const store = createWithdrawStore()
    const before = store.intentsOf('ses-1')
    expect(store.intentsOf('ses-1')).toBe(before)
    store.request(intent)
    expect(store.intentsOf('ses-1')).not.toBe(before)
  })

  it('answers for the intent it still holds', () => {
    const store = createWithdrawStore()
    expect(store.holds(intent)).toBe(false)
    store.request(intent)
    expect(store.holds(intent)).toBe(true)
    store.clear('ses-1')
    expect(store.holds(intent)).toBe(false)
  })
})
