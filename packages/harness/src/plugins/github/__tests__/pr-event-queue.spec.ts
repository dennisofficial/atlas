import { describe, expect, it } from 'bun:test'
import { EPrEventKind, toThreadId, type EventDraft } from '@dltech/atlas-core'

import { MessageIntake } from '../../../intake/message-intake'
import { PrEventNoticeQueue, prEventIntakeSource } from '../pr-event-queue'

const MAIN = toThreadId('main')
const CHILD = toThreadId('child')

const draft = (prNumber: number): EventDraft => ({
  type: 'pr-event',
  repo: 'github.com/owner/repo',
  prNumber,
  kind: EPrEventKind.Comment,
  url: `https://github.com/owner/repo/pull/${prNumber}`,
  authorLogin: 'octocat',
  body: 'looks good',
})

const flush = async (): Promise<void> => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

describe('PrEventNoticeQueue', () => {
  it('captures only the asking thread and wakes it', () => {
    const queue = new PrEventNoticeQueue()
    queue.queue({ threadId: MAIN, draft: draft(1) })
    queue.queue({ threadId: CHILD, draft: draft(2) })

    const batch = queue.prepare({ threadId: MAIN })

    expect(batch.drafts).toEqual([draft(1)])
    expect(batch.wakesTurn).toBe(true)
    expect(queue.prepare({ threadId: toThreadId('other') })).toMatchObject({ drafts: [], wakesTurn: false })
  })

  it('keeps notices until acknowledged and acknowledges only what it captured', () => {
    const queue = new PrEventNoticeQueue()
    queue.queue({ threadId: MAIN, draft: draft(1) })
    const batch = queue.prepare({ threadId: MAIN })
    queue.queue({ threadId: MAIN, draft: draft(2) })

    expect(queue.pending({ threadId: MAIN })).toHaveLength(2)
    batch.acknowledge()
    batch.acknowledge()

    expect(queue.pending({ threadId: MAIN }).map((notice) => notice.draft)).toEqual([draft(2)])
  })

  it('leaves the queue intact when a prepared batch is released unacknowledged', () => {
    const queue = new PrEventNoticeQueue()
    queue.queue({ threadId: MAIN, draft: draft(1) })

    queue.prepare({ threadId: MAIN })

    expect(queue.threadsAwaiting()).toEqual([MAIN])
  })

  it('drains drafts and empties the thread', () => {
    const queue = new PrEventNoticeQueue()
    queue.queue({ threadId: MAIN, draft: draft(1) })

    expect(queue.drain({ threadId: MAIN })).toEqual([draft(1)])
    expect(queue.threadsAwaiting()).toEqual([])
  })

  it('hands out a stable pending reference between changes', () => {
    const queue = new PrEventNoticeQueue()
    queue.queue({ threadId: MAIN, draft: draft(1) })

    expect(queue.pending({ threadId: MAIN })).toBe(queue.pending({ threadId: MAIN }))
    expect(queue.pending({ threadId: CHILD })).toBe(queue.pending({ threadId: CHILD }))
  })

  it('moves a finished child’s notices to its parent and ignores a no-op reassign', () => {
    const queue = new PrEventNoticeQueue()
    queue.queue({ threadId: CHILD, draft: draft(1) })
    queue.reassign({ from: MAIN, to: CHILD })
    queue.reassign({ from: CHILD, to: CHILD })
    queue.reassign({ from: CHILD, to: MAIN })

    expect(queue.threadsAwaiting()).toEqual([MAIN])
    expect(queue.pending({ threadId: MAIN })[0]?.threadId).toBe(MAIN)
  })

  it('forgets a thread’s notices', () => {
    const queue = new PrEventNoticeQueue()
    queue.queue({ threadId: MAIN, draft: draft(1) })
    queue.queue({ threadId: CHILD, draft: draft(2) })

    queue.forget({ threadId: MAIN })
    queue.forget({ threadId: MAIN })

    expect(queue.threadsAwaiting()).toEqual([CHILD])
  })

  it('notifies listeners once per change and stops after unsubscribe', () => {
    const queue = new PrEventNoticeQueue()
    let heard = 0
    const stop = queue.onNotice(() => void (heard += 1))

    queue.queue({ threadId: MAIN, draft: draft(1) })
    queue.prepare({ threadId: MAIN }).acknowledge()
    expect(heard).toBe(2)

    stop()
    queue.queue({ threadId: MAIN, draft: draft(2) })
    expect(heard).toBe(2)
  })
})

describe('PrEventNoticeQueue through MessageIntake', () => {
  it('wakes an idle owner when a notice arrives', async () => {
    const queue = new PrEventNoticeQueue()
    const intake = new MessageIntake({ sources: [prEventIntakeSource(queue)] })
    let woke = 0
    intake.register({
      threadId: MAIN,
      driver: {
        blocked: () => false,
        wake: () => {
          woke += 1
          queue.drain({ threadId: MAIN })
        },
      },
    })

    queue.queue({ threadId: MAIN, draft: draft(1) })
    await flush()

    expect(woke).toBe(1)
    intake.dispose()
  })

  it('does not wake a running owner but hands the draft over at the next drain', async () => {
    const queue = new PrEventNoticeQueue()
    const intake = new MessageIntake({ sources: [prEventIntakeSource(queue)] })
    let woke = 0
    intake.register({ threadId: MAIN, driver: { blocked: () => true, wake: () => void (woke += 1) } })

    queue.queue({ threadId: MAIN, draft: draft(1) })
    await flush()
    expect(woke).toBe(0)

    const appended: EventDraft[] = []
    const committed = await intake.commit({
      threadId: MAIN,
      append: async (drafts) => void appended.push(...drafts),
    })

    expect(appended).toEqual([draft(1)])
    expect(committed.wakesTurn).toBe(true)
    expect(queue.threadsAwaiting()).toEqual([])
    intake.dispose()
  })

  it('keeps the notice when appending fails', async () => {
    const queue = new PrEventNoticeQueue()
    const intake = new MessageIntake({ sources: [prEventIntakeSource(queue)] })
    queue.queue({ threadId: MAIN, draft: draft(1) })

    await expect(
      intake.commit({ threadId: MAIN, append: async () => { throw new Error('disk full') } }),
    ).rejects.toThrow('disk full')

    expect(queue.threadsAwaiting()).toEqual([MAIN])
    intake.dispose()
  })
})
