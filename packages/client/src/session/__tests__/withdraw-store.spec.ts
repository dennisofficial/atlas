import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  toRunId,
  toThreadId,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { createWithdrawStore, type WithdrawStorePersistence } from '../withdraw-store'
import type { WithdrawIntent } from '../withdraw-queue'

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

const REFUSED: RecordEventBody = {
  type: 'input-refused',
  inboxId: 9,
  targetInboxId: 4,
  reason: 'already-sent',
}

const intent: WithdrawIntent = { sessionId: 'ses-1', targetInboxId: 4 }

const memoryPersistence = (): WithdrawStorePersistence & { held: WithdrawIntent[] } => {
  const held: WithdrawIntent[] = []
  return {
    held,
    load: () => held,
    save: (intents) => {
      held.splice(0, held.length, ...intents)
    },
  }
}

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

  it('persists an intent and picks it up in a fresh store', async () => {
    const persistence = memoryPersistence()
    const first = createWithdrawStore({ persistence })
    first.request(intent)
    const reloaded = createWithdrawStore({ persistence })
    await Promise.resolve()
    await Promise.resolve()
    expect(reloaded.intentsOf('ses-1')).toEqual([intent])
  })

  it('drops a settled intent from the persisted set', async () => {
    const persistence = memoryPersistence()
    const store = createWithdrawStore({ persistence })
    store.request(intent)
    store.takeSettlements({ sessionId: 'ses-1', events: eventsOf([POSTED, WITHDRAWN]) })
    expect(persistence.held).toEqual([])
  })

  it('ignores persisted entries that are not intents', async () => {
    const persistence: WithdrawStorePersistence = {
      load: () => [{ sessionId: 'ses-1', targetInboxId: 4 }, { sessionId: '' }, null, 7] as never,
      save: () => undefined,
    }
    const store = createWithdrawStore({ persistence })
    await Promise.resolve()
    await Promise.resolve()
    expect(store.intentsOf('ses-1')).toEqual([intent])
  })
})
