import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId, type InboxEntry } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'

import { InboxIntake } from '../inbox-intake'
import type { SessionRecord } from '../record/record-adapter'

const entry = (inboxId: number): InboxEntry =>
  ({
    sessionId: 'session-1',
    inboxId,
    kind: 'message',
    payload: JSON.stringify({ text: `m${inboxId}` }),
    consumedSeq: null,
  }) as InboxEntry

const intakeOver = (readInbox: () => Promise<InboxEntry[]>) =>
  new InboxIntake({
    plane: { readInbox } as unknown as ControlPlane,
    sessionId: 'session-1',
    record: {} as SessionRecord,
    threadId: toThreadId('thread-1'),
    runId: () => toRunId('run-1'),
  })

describe('InboxIntake', () => {
  it('rejects when the inbox read fails instead of draining nothing', async () => {
    const intake = intakeOver(async () => {
      throw new Error('inbox read blew up')
    })
    await expect(intake.prepare()).rejects.toThrow('inbox read blew up')
  })

  it('drains the message on the retry after a failed read', async () => {
    let calls = 0
    const intake = intakeOver(async () => {
      calls += 1
      if (calls === 1) throw new Error('blip')
      return [entry(1)]
    })
    await expect(intake.prepare()).rejects.toThrow('blip')
    const drain = await intake.prepare()
    expect(drain.wakesTurn).toBe(true)
    expect(drain.drafts).toHaveLength(1)
  })
})
