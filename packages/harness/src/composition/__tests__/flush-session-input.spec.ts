import { describe, expect, it } from 'bun:test'
import { toThreadId, toRunId, type EventDraft } from '@dltech/atlas-core'

import { MessageIntake, operatorSource } from '../../intake'
import { createPendingQueues } from '../../pending'
import { flushSessionInput } from '../flush-session-input'

const parent = toThreadId('parent')
const child = toThreadId('child')

describe('shared relocation and teardown input flush', () => {
  it('persists the family queues while intake is suspended without waking loops', async () => {
    const pending = createPendingQueues()
    const intake = new MessageIntake({ sources: [operatorSource(pending)] })
    intake.suspend()
    pending.forThread({ threadId: parent }).enqueue({ text: 'operator parent message' })
    pending.forThread({ threadId: child }).enqueue({ text: 'operator child message' })
    const written: { threadId: string; drafts: readonly EventDraft[] }[] = []
    try {
      expect(await flushSessionInput({
        intake,
        log: { append: async (args) => { written.push(args); return [] } },
        ids: { nextRunId: () => toRunId('flush') },
      })).toEqual([parent, child])
      expect(written.map((entry) => entry.drafts)).toEqual([
        [{ type: 'user-said', text: 'operator parent message' }],
        [{ type: 'user-said', text: 'operator child message' }],
      ])
      expect(pending.waitingCount()).toBe(0)
    } finally { intake.dispose() }
  })

  it('releases the reservation without consuming queued messages after persistence failure', async () => {
    const pending = createPendingQueues()
    pending.forThread({ threadId: parent }).enqueue({ text: 'keep me' })
    const intake = new MessageIntake({ sources: [operatorSource(pending)] })
    intake.suspend()
    try {
      await expect(flushSessionInput({
        intake, log: { append: async () => { throw new Error('disk full') } },
        ids: { nextRunId: () => toRunId('flush') },
      })).rejects.toThrow('disk full')
      expect(pending.waitingCount()).toBe(1)
      expect(await flushSessionInput({
        intake, log: { append: async () => [] }, ids: { nextRunId: () => toRunId('retry') },
      })).toEqual([parent])
      expect(pending.waitingCount()).toBe(0)
    } finally { intake.dispose() }
  })
})
