import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  toRunId,
  toThreadId,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { createWithdrawStore } from '../withdraw-store'
import {
  ALREADY_SENT_NOTICE,
  WITHDRAW_UNKNOWN_NOTICE,
  requestWithdraw,
  withdrawRefusalNoticeOf,
  withdrawSettlementsOf,
  type WithdrawIntent,
} from '../withdraw-queue'

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

describe('withdrawSettlementsOf', () => {
  it('leaves an intent unsettled until the holder answers', () => {
    expect(withdrawSettlementsOf({ intents: [intent], events: eventsOf([POSTED]) })).toEqual([])
  })

  it('settles a withdrawn target', () => {
    expect(
      withdrawSettlementsOf({ intents: [intent], events: eventsOf([POSTED, WITHDRAWN]) }),
    ).toEqual([{ targetInboxId: 4, status: 'withdrawn' }])
  })

  it('refuses a target the holder already received', () => {
    expect(
      withdrawSettlementsOf({ intents: [intent], events: eventsOf([POSTED, REFUSED]) }),
    ).toEqual([{ targetInboxId: 4, status: 'refused', notice: ALREADY_SENT_NOTICE }])
  })

  it('refuses a target after the operator already saw the text come back', () => {
    const restored = { sessionId: 'ses-1', targetInboxId: 4 }
    expect(
      withdrawSettlementsOf({
        intents: [restored],
        events: eventsOf([POSTED, REFUSED]),
      }),
    ).toEqual([{ targetInboxId: 4, status: 'refused', notice: ALREADY_SENT_NOTICE }])
  })

  it('prefers a withdrawal over a refusal for the same target', () => {
    expect(
      withdrawSettlementsOf({
        intents: [intent],
        events: eventsOf([POSTED, REFUSED, WITHDRAWN]),
      }),
    ).toEqual([{ targetInboxId: 4, status: 'withdrawn' }])
  })

  it('ignores an outcome for another target', () => {
    expect(
      withdrawSettlementsOf({
        intents: [{ sessionId: 'ses-1', targetInboxId: 7 }],
        events: eventsOf([POSTED, WITHDRAWN]),
      }),
    ).toEqual([])
  })

  it('refuses a message the holder did not find, using the refusal inbox id', () => {
    expect(
      withdrawSettlementsOf({
        intents: [{ sessionId: 'ses-1', targetInboxId: 11 }],
        events: eventsOf([{ type: 'input-refused', inboxId: 11, reason: 'already-consumed' }]),
      }),
    ).toEqual([{ targetInboxId: 11, status: 'refused', notice: ALREADY_SENT_NOTICE }])
  })
})

describe('withdrawRefusalNoticeOf', () => {
  it('names an already-received message', () => {
    expect(withdrawRefusalNoticeOf('already-sent')).toBe(ALREADY_SENT_NOTICE)
    expect(withdrawRefusalNoticeOf('already-consumed')).toBe(ALREADY_SENT_NOTICE)
  })

  it('names a message that is no longer queued', () => {
    expect(withdrawRefusalNoticeOf('only an operator message can be withdrawn')).toBe(
      WITHDRAW_UNKNOWN_NOTICE,
    )
  })
})

const QUEUED: ReadonlySet<number> = new Set([4])

describe('requestWithdraw', () => {
  it('records the intent before it asks the API', async () => {
    const store = createWithdrawStore()
    let heldWhenAsked = false
    const request = requestWithdraw({
      api: {
        withdraw: async () => {
          heldWhenAsked = store.holds(intent)
          return { ok: true }
        },
      },
      intents: store,
      intent,
    })

    expect(request.recorded).toBe(true)
    expect(await request.outcome).toEqual({ kind: 'accepted' })
    expect(heldWhenAsked).toBe(true)
  })

  it('ignores a second request for the same target', async () => {
    const store = createWithdrawStore()
    store.request(intent)
    const request = requestWithdraw({
      api: { withdraw: async () => ({ ok: true }) },
      intents: store,
      intent,
    })

    expect(request.recorded).toBe(false)
    expect(await request.outcome).toEqual({ kind: 'ignored' })
  })

  it('refuses at once and lets the row come back', async () => {
    const store = createWithdrawStore()
    const request = requestWithdraw({
      api: { withdraw: async () => ({ ok: false, reason: 'already-consumed' }) },
      intents: store,
      intent,
    })

    expect(await request.outcome).toEqual({ kind: 'refused', notice: ALREADY_SENT_NOTICE })
    expect(store.intentsOf('ses-1')).toEqual([])
  })

  it('stays quiet when a refusal lands after the durable lane settled it', async () => {
    const store = createWithdrawStore()
    const request = requestWithdraw({
      api: { withdraw: async () => ({ ok: false, reason: 'already-consumed' }) },
      intents: store,
      intent,
    })

    expect(
      store.takeSettlements({
        sessionId: 'ses-1',
        events: eventsOf([POSTED, REFUSED]),
        queuedInboxIds: QUEUED,
        queueKnown: true,
      }),
    ).toEqual([{ targetInboxId: 4, status: 'refused', notice: ALREADY_SENT_NOTICE }])
    expect(await request.outcome).toEqual({ kind: 'ignored' })
  })

  it('stays quiet when the call fails after the durable lane settled it', async () => {
    const store = createWithdrawStore()
    const request = requestWithdraw({
      api: {
        withdraw: async () => {
          throw new Error('offline')
        },
      },
      intents: store,
      intent,
    })

    store.takeSettlements({
      sessionId: 'ses-1',
      events: eventsOf([POSTED, WITHDRAWN]),
      queuedInboxIds: QUEUED,
      queueKnown: true,
    })
    expect(await request.outcome).toEqual({ kind: 'ignored' })
  })

  it('reports a failure while the intent is still pending and unhides the row', async () => {
    const store = createWithdrawStore()
    const failure = new Error('offline')
    const request = requestWithdraw({
      api: {
        withdraw: async () => {
          throw failure
        },
      },
      intents: store,
      intent,
    })

    expect(await request.outcome).toEqual({ kind: 'failed', failure })
    expect(store.intentsOf('ses-1')).toEqual([])
  })
})
