import { describe, expect, it } from 'bun:test'
import { EMessageOrigin, toThreadId } from '@dltech/atlas-core'

import { createPendingQueues } from '../../pending'
import { MessageIntake } from '../message-intake'
import { operatorSource } from '../sources'

const THREAD = toThreadId('owner')
const flush = async (): Promise<void> => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}
const fixture = () => {
  const pending = createPendingQueues()
  const intake = new MessageIntake({ sources: [operatorSource(pending)] })
  return { pending, intake }
}

describe('intake reservations', () => {
  it('lets interruption cancel a waiter without consuming the held input', async () => {
    const { pending, intake } = fixture()
    intake.submit({ threadId: THREAD, text: 'retained' })
    const held = await intake.prepare({ threadId: THREAD })
    const abort = new AbortController()
    const waiting = intake.prepare({ threadId: THREAD, signal: abort.signal })
    abort.abort(new Error('interrupted'))
    await expect(waiting).rejects.toThrow('interrupted')
    expect(pending.waitingCount()).toBe(1)
    held.release?.()
    const next = await intake.prepare({ threadId: THREAD })
    expect(next.drafts).toHaveLength(1)
    next.acknowledge()
    intake.dispose()
  })

  it('rejects both a parked waiter and a new prepare after disposal', async () => {
    const { intake } = fixture()
    const held = await intake.prepare({ threadId: THREAD })
    const waiting = intake.prepare({ threadId: THREAD })
    intake.dispose()
    await expect(waiting).rejects.toThrow('closed')
    await expect(intake.prepare({ threadId: THREAD })).rejects.toThrow('closed')
    held.release?.()
  })

  it('structurally releases failed commits so the next commit can retry', async () => {
    const { pending, intake } = fixture()
    intake.submit({ threadId: THREAD, text: 'do not lose this' })
    await expect(intake.commit({
      threadId: THREAD, append: async () => { throw new Error('disk unavailable') },
    })).rejects.toThrow('disk unavailable')
    expect(pending.forThread({ threadId: THREAD }).takeBackLast()?.text).toBe('do not lose this')
    intake.submit({ threadId: THREAD, text: 'retried' })
    const stored: unknown[] = []
    await intake.commit({ threadId: THREAD, append: async (drafts) => { stored.push(...drafts) } })
    expect(stored).toHaveLength(1)
    expect(pending.waitingCount()).toBe(0)
    intake.dispose()
  })

  it('holds scheduler wakes during an explicit startup and releases exactly once', async () => {
    const { intake } = fixture()
    let busy = false
    let wakes = 0
    intake.register({ threadId: THREAD, driver: { blocked: () => busy, wake: () => { wakes += 1; busy = true } } })
    const release = intake.hold({ threadId: THREAD })
    intake.submit({ threadId: THREAD, text: 'explicit start' })
    await flush()
    expect(wakes).toBe(0)
    release()
    release()
    await flush()
    expect(wakes).toBe(1)
    intake.dispose()
  })

  it('suspends new wakes at teardown without blocking pending input persistence', async () => {
    const { intake } = fixture()
    let wakes = 0
    intake.register({ threadId: THREAD, driver: { blocked: () => false, wake: () => { wakes += 1 } } })
    intake.suspend()
    intake.submit({ threadId: THREAD, text: 'accepted before close' })
    await flush()
    expect(wakes).toBe(0)
    expect(intake.threadsWithPendingInput()).toEqual([THREAD])
    await intake.commit({ threadId: THREAD, append: async () => undefined })
    expect(intake.threadsWithPendingInput()).toEqual([])
    intake.dispose()
  })

  it('keeps parent and peer messages immutable without stealing operator editability', async () => {
    const { pending, intake } = fixture()
    const queue = pending.forThread({ threadId: THREAD })
    intake.submit({ threadId: THREAD, text: 'parent instruction', via: EMessageOrigin.ParentAgent })
    expect(queue.takeBackLast()).toBeNull()
    intake.submit({ threadId: THREAD, text: 'operator draft' })
    expect(queue.takeBackLast()?.text).toBe('operator draft')
    intake.submit({ threadId: THREAD, text: 'peer instruction', via: EMessageOrigin.PeerAgent })
    expect(queue.takeBackLast()).toBeNull()
    const batch = await intake.prepare({ threadId: THREAD })
    expect(batch.drafts.map((draft) => draft.type === 'user-said' ? draft.via : null)).toEqual([
      EMessageOrigin.ParentAgent, EMessageOrigin.PeerAgent,
    ])
    batch.acknowledge()
    intake.dispose()
  })
})
