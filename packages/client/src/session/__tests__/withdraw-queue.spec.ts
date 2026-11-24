import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  EAttachmentStore,
  toRunId,
  toThreadId,
  type Attachment,
  type V2Body,
} from '@dltech/atlas-core'

import { withdrawRefusalNoticeOf, withdrawStepOf, type WithdrawRequest } from '../withdraw-queue'

const eventsOf = (bodies: readonly V2Body[]) =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-24T10:00:00.000Z',
    from: undefined,
    bodies,
  })

const shot: Attachment = {
  id: 'shot-1',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 12,
  content: { store: EAttachmentStore.Inline, data: 'AAAA' },
}

const editOf = (args: Partial<WithdrawRequest> = {}): WithdrawRequest => ({
  targetInboxId: 8,
  restoreText: true,
  text: 'first',
  attachments: [shot],
  ...args,
})

const withdrawnAt = (inboxId: number) =>
  eventsOf([{ type: 'input-withdrawn', inboxId, requestInboxId: 12 }])

const refusedAt = (args: { inboxId: number; targetInboxId?: number; reason: string }): V2Body => ({
  type: 'input-refused',
  inboxId: args.inboxId,
  reason: args.reason,
  ...(args.targetInboxId === undefined ? {} : { targetInboxId: args.targetInboxId }),
})

describe('withdrawStepOf', () => {
  it('restores nothing when the lane is removed', () => {
    const step = withdrawStepOf({
      requests: [editOf({ restoreText: false })],
      handled: new Set(),
      events: withdrawnAt(8),
    })
    expect(step.restore).toBeUndefined()
    expect(step.notices).toEqual([])
    expect([...step.handled]).toEqual([8])
  })

  it('restores an edited message once, with its attachments', () => {
    const request = editOf()
    const first = withdrawStepOf({
      requests: [request],
      handled: new Set(),
      events: withdrawnAt(8),
    })
    expect(first.restore).toEqual({ text: 'first', attachments: [shot] })

    const second = withdrawStepOf({
      requests: [request],
      handled: first.handled,
      events: withdrawnAt(8),
    })
    expect(second.restore).toBeUndefined()
    expect(second.handled).toBe(first.handled)
  })

  it('waits for the holder before restoring a message from another device', () => {
    const request = editOf()
    const waiting = withdrawStepOf({ requests: [request], handled: new Set(), events: [] })
    expect(waiting.restore).toBeUndefined()
    expect(waiting.handled.size).toBe(0)

    const elsewhere = withdrawStepOf({
      requests: [request],
      handled: waiting.handled,
      events: withdrawnAt(9),
    })
    expect(elsewhere.restore).toBeUndefined()

    const confirmed = withdrawStepOf({
      requests: [request],
      handled: elsewhere.handled,
      events: withdrawnAt(8),
    })
    expect(confirmed.restore).toEqual({ text: 'first', attachments: [shot] })
  })

  it('restores nothing and says already sent when the holder refuses the withdraw', () => {
    const step = withdrawStepOf({
      requests: [editOf()],
      handled: new Set(),
      events: eventsOf([refusedAt({ inboxId: 12, targetInboxId: 8, reason: 'already-sent' })]),
    })
    expect(step.restore).toBeUndefined()
    expect(step.notices).toEqual(['Already sent'])
    expect([...step.handled]).toEqual([8])
  })

  it('joins the text of every confirmed edit ahead of the composer', () => {
    const step = withdrawStepOf({
      requests: [editOf({ targetInboxId: 8 }), editOf({ targetInboxId: 9, text: 'second' })],
      handled: new Set(),
      events: eventsOf([
        { type: 'input-withdrawn', inboxId: 8, requestInboxId: 12 },
        { type: 'input-withdrawn', inboxId: 9, requestInboxId: 13 },
      ]),
    })
    expect(step.restore?.text).toBe('first\n\nsecond')
    expect(step.restore?.attachments).toEqual([shot, shot])
  })

  it('does not read a refusal of the message itself as a refusal of the withdraw', () => {
    const step = withdrawStepOf({
      requests: [editOf()],
      handled: new Set(),
      events: eventsOf([refusedAt({ inboxId: 8, reason: 'session is archived' })]),
    })
    expect(step.restore).toBeUndefined()
    expect(step.notices).toEqual([])
    expect(step.handled.size).toBe(0)
  })
})

describe('withdrawRefusalNoticeOf', () => {
  it('names a consumed message once, whichever layer refused it', () => {
    expect(withdrawRefusalNoticeOf('already-sent')).toBe('Already sent')
    expect(withdrawRefusalNoticeOf('already-consumed')).toBe('Already sent')
    expect(withdrawRefusalNoticeOf('only an operator message can be withdrawn')).toBe(
      'That message is no longer queued',
    )
  })
})
