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

const intakeOver = (readInbox: (args: { afterId: number }) => Promise<InboxEntry[]>) =>
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

  it('tags each drafted message with its inbox id', async () => {
    const drain = await intakeOver(async () => [entry(4)]).prepare()
    expect(drain.drafts).toEqual([
      { type: 'user-said', text: 'm4', requestId: 'inbox:4', inboxId: 4 },
    ])
  })

  it('offers an entry again on the next prepare when its append never consumed it', async () => {
    const afterIds: number[] = []
    const intake = intakeOver(async ({ afterId }) => {
      afterIds.push(afterId)
      return [entry(1), entry(2)]
    })
    const first = await intake.prepare()
    const second = await intake.prepare()
    expect(afterIds).toEqual([0, 0])
    expect(second.drafts).toEqual(first.drafts)
    expect(second.drafts).toHaveLength(2)
  })
})
