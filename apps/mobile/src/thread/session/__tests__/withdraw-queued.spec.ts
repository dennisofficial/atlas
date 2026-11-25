import { describe, expect, it } from 'bun:test'

import type { Attachment, PendingInputsState } from '@dltech/atlas-core'

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
      intent: { sessionId: 'ses-1', targetInboxId: 4 },
      restore: { text: 'ship it', attachments: [attachment] },
    })
  })

  it('restores nothing for a remove', () => {
    expect(
      queuedWithdrawPlanOf({ sessionId: 'ses-1', pending, inboxId: 4, restoreText: false }),
    ).toEqual({ intent: { sessionId: 'ses-1', targetInboxId: 4 }, restore: undefined })
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
