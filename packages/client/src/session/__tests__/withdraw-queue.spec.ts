import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  toRunId,
  toThreadId,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'

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

describe('requestWithdraw', () => {
  it('accepts a queued request', async () => {
    const asked: unknown[] = []
    const outcome = await requestWithdraw({
      api: {
        withdraw: async (input) => {
          asked.push(input)
          return { ok: true }
        },
      },
      sessionId: 'ses-1',
      targetInboxId: 4,
    })
    expect(outcome).toEqual({ accepted: true })
    expect(asked).toEqual([{ sessionId: 'ses-1', inboxId: 4 }])
  })

  it('reports a refusal the API makes at once', async () => {
    const outcome = await requestWithdraw({
      api: { withdraw: async () => ({ ok: false, reason: 'already-consumed' }) },
      sessionId: 'ses-1',
      targetInboxId: 4,
    })
    expect(outcome).toEqual({ accepted: false, notice: ALREADY_SENT_NOTICE })
  })
})
