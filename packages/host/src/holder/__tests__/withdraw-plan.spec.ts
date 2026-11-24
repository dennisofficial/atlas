import { describe, expect, it } from 'bun:test'

import { EMessageOrigin, ESetupPhase, type InboxEntry, type PendingInput } from '@dltech/atlas-core'
import { INBOX_KIND_WITHDRAW } from '@dltech/atlas-control'

import { withdrawPlanOf, type WithdrawLookup } from '../withdraw-plan'

const withdrawEntry = (args: { inboxId: number; targetInboxId: number }): InboxEntry => ({
  sessionId: 'session-1',
  inboxId: args.inboxId,
  kind: INBOX_KIND_WITHDRAW,
  payload: JSON.stringify({ targetInboxId: args.targetInboxId }),
  postedAt: '2026-11-20T10:00:00.000Z',
  consumedSeq: null,
  threadId: null,
  senderSessionId: null,
})

const stagedOf = (args: { inboxId: number; kind: string }): InboxEntry => ({
  sessionId: 'session-1',
  inboxId: args.inboxId,
  kind: args.kind,
  payload: '{}',
  postedAt: '2026-11-20T10:00:00.000Z',
  consumedSeq: null,
  threadId: null,
  senderSessionId: null,
})

const lookupOf = (args: {
  staged?: readonly InboxEntry[]
  pending?: readonly PendingInput[]
}): WithdrawLookup => ({
  stagedOf: (inboxId) => args.staged?.find((entry) => entry.inboxId === inboxId),
  pendingOf: (inboxId) => args.pending?.find((entry) => entry.inboxId === inboxId),
  postedDraftsOf: (entry) => [
    { type: 'input-posted', inboxId: entry.inboxId, kind: entry.kind, postedAt: entry.postedAt },
  ],
})

describe('withdrawPlanOf', () => {
  it('withdraws a message that is staged and not yet posted', () => {
    const plan = withdrawPlanOf({
      entry: withdrawEntry({ inboxId: 5, targetInboxId: 4 }),
      lookup: lookupOf({ staged: [stagedOf({ inboxId: 4, kind: 'message' })] }),
    })
    expect(plan.withdrawn).toBe(4)
  })

  it('withdraws a message the drain has not reached', () => {
    const plan = withdrawPlanOf({
      entry: withdrawEntry({ inboxId: 5, targetInboxId: 4 }),
      lookup: lookupOf({
        pending: [
          {
            inboxId: 4,
            seq: 3,
            at: '2026-11-20T10:00:00.000Z',
            kind: 'message',
            message: { text: 'hello' },
          },
        ],
      }),
    })
    expect(plan.withdrawn).toBe(4)
  })

  it('refuses to withdraw a staged notice', () => {
    const plan = withdrawPlanOf({
      entry: withdrawEntry({ inboxId: 5, targetInboxId: 4 }),
      lookup: lookupOf({ staged: [stagedOf({ inboxId: 4, kind: 'event' })] }),
    })
    expect(plan).toEqual({
      drafts: [
        {
          type: 'input-refused',
          inboxId: 5,
          targetInboxId: 4,
          reason: 'only a message can be withdrawn',
        },
      ],
    })
  })

  it('refuses to withdraw a notice the drain has not reached', () => {
    const plan = withdrawPlanOf({
      entry: withdrawEntry({ inboxId: 5, targetInboxId: 4 }),
      lookup: lookupOf({
        pending: [
          {
            inboxId: 4,
            seq: 3,
            at: '2026-11-20T10:00:00.000Z',
            kind: 'event',
            event: {
              type: 'sandbox-setup-reported',
              text: 'setup finished',
              failed: false,
              phase: ESetupPhase.Finished,
            },
          },
        ],
      }),
    })
    expect(plan).toEqual({
      drafts: [
        {
          type: 'input-refused',
          inboxId: 5,
          targetInboxId: 4,
          reason: 'only a message can be withdrawn',
        },
      ],
    })
  })

  it('refuses to withdraw a staged message another session sent', () => {
    const plan = withdrawPlanOf({
      entry: withdrawEntry({ inboxId: 5, targetInboxId: 4 }),
      lookup: lookupOf({
        staged: [
          {
            ...stagedOf({ inboxId: 4, kind: 'message' }),
            payload: JSON.stringify({ text: 'handoff', via: EMessageOrigin.PeerAgent }),
            senderSessionId: 'session-2',
          },
        ],
      }),
    })
    expect(plan).toEqual({
      drafts: [
        {
          type: 'input-refused',
          inboxId: 5,
          targetInboxId: 4,
          reason: 'only an operator message can be withdrawn',
        },
      ],
    })
  })

  it('refuses to withdraw a pending message an agent sent', () => {
    const plan = withdrawPlanOf({
      entry: withdrawEntry({ inboxId: 5, targetInboxId: 4 }),
      lookup: lookupOf({
        pending: [
          {
            inboxId: 4,
            seq: 3,
            at: '2026-11-20T10:00:00.000Z',
            kind: 'message',
            message: {
              text: 'handoff',
              via: EMessageOrigin.PeerAgent,
              sender: { session: 'session-2' },
            },
          },
        ],
      }),
    })
    expect(plan.withdrawn).toBeUndefined()
    expect(plan.drafts).toEqual([
      {
        type: 'input-refused',
        inboxId: 5,
        targetInboxId: 4,
        reason: 'only an operator message can be withdrawn',
      },
    ])
  })
})
