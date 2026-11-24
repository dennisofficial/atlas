import { describe, expect, it } from 'bun:test'

import { EAttachmentStore, type Attachment } from '@dltech/atlas-core'

import { v2EventSchema } from '../registered-plugins'
import { withdrawRefusalNoticeOf, withdrawStepOf, type WithdrawRequest } from '../withdraw-queue'

const envelope = (seq: number) => ({
  id: `evt_${seq}`,
  seq,
  threadId: 'thr_1',
  runId: 'run_1',
  depth: 0,
  at: `2026-11-08T20:00:0${seq}.000Z`,
  epoch: 0,
  prevHash: '0'.repeat(64),
})

const eventsOf = (events: readonly unknown[]) => events.map((event) => v2EventSchema.parse(event))

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

const withdrawnAt = (seq: number, inboxId: number) =>
  eventsOf([{ ...envelope(seq), type: 'input-withdrawn', inboxId, requestInboxId: 12 }])

describe('withdrawStepOf', () => {
  it('restores nothing when the lane is removed', () => {
    const step = withdrawStepOf({
      requests: [editOf({ restoreText: false })],
      handled: new Set(),
      events: withdrawnAt(2, 8),
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
      events: withdrawnAt(2, 8),
    })
    expect(first.restore).toEqual({ text: 'first', attachments: [shot] })

    const second = withdrawStepOf({
      requests: [request],
      handled: first.handled,
      events: withdrawnAt(2, 8),
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
      events: withdrawnAt(2, 9),
    })
    expect(elsewhere.restore).toBeUndefined()

    const confirmed = withdrawStepOf({
      requests: [request],
      handled: elsewhere.handled,
      events: withdrawnAt(2, 8),
    })
    expect(confirmed.restore).toEqual({ text: 'first', attachments: [shot] })
  })

  it('restores nothing and says already sent when the holder refuses the withdraw', () => {
    const step = withdrawStepOf({
      requests: [editOf()],
      handled: new Set(),
      events: eventsOf([
        {
          ...envelope(2),
          type: 'input-refused',
          inboxId: 12,
          targetInboxId: 8,
          reason: 'already-sent',
        },
      ]),
    })
    expect(step.restore).toBeUndefined()
    expect(step.notices).toEqual(['Already sent'])
    expect([...step.handled]).toEqual([8])
  })

  it('does not read a refusal of the message itself as a refusal of the withdraw', () => {
    const step = withdrawStepOf({
      requests: [editOf()],
      handled: new Set(),
      events: eventsOf([
        { ...envelope(2), type: 'input-refused', inboxId: 8, reason: 'session is archived' },
      ]),
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
