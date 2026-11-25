import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  EInputConsumed,
  toRunId,
  toThreadId,
  type Attachment,
  type PendingInputsState,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'
import { createWithdrawStore } from '@dltech/atlas-client/session'

import { queuedWithdrawPlanOf, withdrawalNoticesOf } from '../withdraw-queued'

const attachment: Attachment = {
  id: 'att-1',
  name: 'diagram.png',
  mediaType: 'image/png',
  size: 12,
  content: { store: 'inline', data: 'aGVsbG8=' },
}

const pending: PendingInputsState = {
  pending: [
    {
      inboxId: 4,
      seq: 4,
      at: '2026-11-25T10:00:00.000Z',
      kind: 'message',
      message: { text: 'ship it', attachments: [attachment] },
    },
  ],
}

describe('queuedWithdrawPlanOf', () => {
  it('puts the text and attachments back for an edit', () => {
    expect(
      queuedWithdrawPlanOf({ sessionId: 'ses-1', pending, inboxId: 4, restoreText: true }),
    ).toEqual({
      target: { sessionId: 'ses-1', targetInboxId: 4 },
      restore: { text: 'ship it', attachments: [attachment] },
    })
  })

  it('restores nothing for a remove', () => {
    expect(
      queuedWithdrawPlanOf({ sessionId: 'ses-1', pending, inboxId: 4, restoreText: false }),
    ).toEqual({ target: { sessionId: 'ses-1', targetInboxId: 4 }, restore: undefined })
  })

  it('has no plan for a message that is no longer queued', () => {
    expect(
      queuedWithdrawPlanOf({ sessionId: 'ses-1', pending, inboxId: 9, restoreText: true }),
    ).toBeUndefined()
  })
})

describe('withdrawalNoticesOf', () => {
  it('names only the refused withdrawals', () => {
    expect(
      withdrawalNoticesOf([
        { targetInboxId: 4, status: 'withdrawn' },
        { targetInboxId: 5, status: 'refused', notice: 'Already sent — the agent got it' },
      ]),
    ).toEqual(['Already sent — the agent got it'])
  })
})

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

describe('a message the operator edited before the agent took it', () => {
  it('notices the refusal exactly once after the target leaves the queue', () => {
    const store = createWithdrawStore()
    store.request({ sessionId: 'ses-1', targetInboxId: 4 })
    expect(
      store.takeSettlements({ sessionId: 'ses-1', events: eventsOf([POSTED, CONSUMED]) }),
    ).toEqual([])
    const settled = store.takeSettlements({
      sessionId: 'ses-1',
      events: eventsOf([POSTED, CONSUMED, REFUSED]),
    })
    expect(withdrawalNoticesOf(settled)).toEqual(['Already sent — the agent got it'])
  })
})
