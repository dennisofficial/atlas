import { describe, expect, it } from 'bun:test'
import { EAgentStatus, isTurnTaking, toThreadId, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import { createPendingQueues } from '../../pending'
import { MessageIntake, type IntakeSource } from '../message-intake'
import { operatorSource } from '../sources'

const MAIN = toThreadId('main')
const CHILD = toThreadId('child')
const said = (text: string): EventDraft => ({ type: 'user-said', text })
const flush = async (): Promise<void> => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

function source() {
  let entries: readonly { threadId: ThreadId; draft: EventDraft }[] = []
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }
  const input: IntakeSource = {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    threadsAwaitingInput: () => [...new Set(entries.filter((entry) => isTurnTaking(entry.draft)).map((entry) => entry.threadId))],
    prepare: ({ threadId }) => {
      const captured = entries.filter((entry) => entry.threadId === threadId)
      return {
        drafts: captured.map((entry) => entry.draft),
        wakesTurn: captured.some((entry) => isTurnTaking(entry.draft)),
        acknowledge: () => {
          if (captured.length === 0) return
          entries = entries.filter((entry) => !captured.includes(entry))
          notify()
        },
      }
    },
  }
  return {
    input,
    enqueue: (args: { threadId: ThreadId; draft: EventDraft }) => {
      entries = [...entries, args]
      notify()
    },
    size: () => entries.length,
  }
}

describe('shared thread intake', () => {
  it('keeps prepared notices pending until persistence acknowledges them', async () => {
    const notices = source()
    const intake = new MessageIntake({ sources: [notices.input] })
    notices.enqueue({ threadId: MAIN, draft: said('report') })
    const first = await intake.prepare({ threadId: MAIN })
    expect(notices.size()).toBe(1)
    let concurrentSettled = false
    const concurrent = intake.prepare({ threadId: MAIN }).then((batch) => {
      concurrentSettled = true
      return batch
    })
    await flush()
    expect(concurrentSettled).toBe(false)
    first.release?.()
    const retried = await concurrent
    expect(retried.drafts).toEqual(first.drafts)
    retried.acknowledge()
    expect(notices.size()).toBe(0)
    intake.dispose()
  })

  it('acknowledges only the captured notices and keeps later arrivals', async () => {
    const notices = source()
    const intake = new MessageIntake({ sources: [notices.input] })
    notices.enqueue({ threadId: MAIN, draft: said('first') })
    const batch = await intake.prepare({ threadId: MAIN })
    notices.enqueue({ threadId: MAIN, draft: said('second') })
    batch.acknowledge()
    expect((await intake.prepare({ threadId: MAIN })).drafts).toEqual([said('second')])
    intake.dispose()
  })

  it('combines immutable notices and editable operator messages through one drain', async () => {
    const notices = source()
    const pending = createPendingQueues()
    const intake = new MessageIntake({ sources: [notices.input, operatorSource(pending)] })
    notices.enqueue({ threadId: MAIN, draft: said('report') })
    pending.forThread({ threadId: MAIN }).enqueue({ text: 'steer' })
    const batch = await intake.prepare({ threadId: MAIN })
    expect(batch.drafts.map((draft) => draft.type === 'user-said' ? draft.text : '')).toEqual(['report', 'steer'])
    expect(pending.waitingCount()).toBe(1)
    batch.acknowledge()
    expect(pending.waitingCount()).toBe(0)
    expect(notices.size()).toBe(0)
    intake.dispose()
  })

  it('returns a reserved operator draft to the editable queue after failed append', async () => {
    const pending = createPendingQueues()
    const queue = pending.forThread({ threadId: MAIN })
    const intake = new MessageIntake({ sources: [operatorSource(pending)] })
    queue.enqueue({ text: 'do not lose me' })
    const batch = await intake.prepare({ threadId: MAIN })
    expect(queue.takeBackLast()).toBeNull()
    batch.release?.()
    expect(queue.takeBackLast()?.text).toBe('do not lose me')
    intake.dispose()
  })

  it('wakes an idle owner rather than an unrelated thread', async () => {
    const notices = source()
    const intake = new MessageIntake({ sources: [notices.input] })
    let main = 0
    let child = 0
    let busy = false
    intake.register({ threadId: MAIN, driver: { blocked: () => false, wake: () => { main += 1 } } })
    intake.register({ threadId: CHILD, driver: { blocked: () => busy, wake: () => { child += 1; busy = true } } })
    notices.enqueue({ threadId: CHILD, draft: said('child shell ended') })
    await flush()
    expect(main).toBe(0)
    expect(child).toBe(1)
    intake.dispose()
  })

  it('rechecks a late notice when the recipient becomes idle', async () => {
    const notices = source()
    const intake = new MessageIntake({ sources: [notices.input] })
    let busy = true
    let wakes = 0
    intake.register({ threadId: MAIN, driver: { blocked: () => busy, wake: () => { wakes += 1; busy = true } } })
    notices.enqueue({ threadId: MAIN, draft: said('arrived after final drain') })
    await flush()
    expect(wakes).toBe(0)
    busy = false
    intake.changed()
    await flush()
    expect(wakes).toBe(1)
    intake.dispose()
  })

  it('wakes for a late operator message using the same idle transition', async () => {
    const pending = createPendingQueues()
    const intake = new MessageIntake({ sources: [operatorSource(pending)] })
    let busy = true
    let wakes = 0
    intake.register({ threadId: MAIN, driver: { blocked: () => busy, wake: () => { wakes += 1; busy = true } } })
    pending.forThread({ threadId: MAIN }).enqueue({ text: 'late steer' })
    await flush()
    busy = false
    intake.changed()
    await flush()
    expect(wakes).toBe(1)
    intake.dispose()
  })

  it('holds a wake behind an overlay until it is cleared', async () => {
    const notices = source()
    const intake = new MessageIntake({ sources: [notices.input] })
    let overlay = true
    let busy = false
    let wakes = 0
    intake.register({ threadId: MAIN, driver: { blocked: () => overlay || busy, wake: () => { wakes += 1; busy = true } } })
    notices.enqueue({ threadId: MAIN, draft: said('report') })
    await flush()
    expect(wakes).toBe(0)
    overlay = false
    intake.changed()
    await flush()
    expect(wakes).toBe(1)
    intake.dispose()
  })

  it('does not start overlapping wakes while asynchronous restart work is pending', async () => {
    const notices = source()
    const intake = new MessageIntake({ sources: [notices.input] })
    let finish = (): void => undefined
    const pending = new Promise<void>((resolve) => { finish = resolve })
    let wakes = 0
    let busy = false
    intake.register({ threadId: MAIN, driver: { blocked: () => busy, wake: () => { wakes += 1; return pending } } })
    notices.enqueue({ threadId: MAIN, draft: said('first') })
    await flush()
    notices.enqueue({ threadId: MAIN, draft: said('second') })
    intake.changed()
    await flush()
    expect(wakes).toBe(1)
    busy = true
    finish()
    await flush()
    expect(wakes).toBe(1)
    intake.dispose()
  })

  it('bounds wakes that fail before their first drain', async () => {
    const notices = source()
    const intake = new MessageIntake({ sources: [notices.input] })
    let wakes = 0
    intake.register({ threadId: MAIN, driver: { blocked: () => false, wake: () => { wakes += 1; throw new Error('failed') } } })
    notices.enqueue({ threadId: MAIN, draft: said('report') })
    await flush()
    expect(wakes).toBe(3)
    intake.changed()
    await flush()
    expect(wakes).toBe(3)
    intake.dispose()
  })

  it('does not spend wake attempts on wakes that are blocked when they fire', async () => {
    const notices = source()
    const intake = new MessageIntake({ sources: [notices.input] })
    let checks = 0
    let wakes = 0
    let woke = false
    intake.register({
      threadId: MAIN,
      driver: {
        blocked: () => {
          checks += 1
          const blockedWhenFiring = checks % 2 === 0 && checks <= 6
          return woke || blockedWhenFiring
        },
        wake: () => { wakes += 1; woke = true },
      },
    })
    notices.enqueue({ threadId: MAIN, draft: said('report') })
    await flush()
    expect(wakes).toBe(1)
    intake.dispose()
  })

  it('bounds fired wakes at the attempt limit even after a skipped wake', async () => {
    const notices = source()
    const intake = new MessageIntake({ sources: [notices.input] })
    let checks = 0
    let wakes = 0
    intake.register({
      threadId: MAIN,
      driver: {
        blocked: () => {
          checks += 1
          return checks === 2
        },
        wake: () => { wakes += 1; throw new Error('failed') },
      },
    })
    notices.enqueue({ threadId: MAIN, draft: said('report') })
    await flush()
    expect(wakes).toBe(3)
    intake.changed()
    await flush()
    expect(wakes).toBe(3)
    intake.dispose()
  })

  it('releases earlier source reservations when a later source cannot prepare', async () => {
    const pending = createPendingQueues()
    const queue = pending.forThread({ threadId: MAIN })
    const failed: IntakeSource = {
      subscribe: () => () => undefined,
      threadsAwaitingInput: () => [],
      prepare: () => { throw new Error('cannot prepare') },
    }
    const intake = new MessageIntake({ sources: [operatorSource(pending), failed] })
    queue.enqueue({ text: 'keep this editable' })
    await expect(intake.prepare({ threadId: MAIN })).rejects.toThrow('cannot prepare')
    expect(queue.takeBackLast()?.text).toBe('keep this editable')
    queue.enqueue({ text: 'retry is not lease-blocked' })
    await expect(intake.prepare({ threadId: MAIN })).rejects.toThrow('cannot prepare')
    expect(queue.takeBackLast()?.text).toBe('retry is not lease-blocked')
    intake.dispose()
  })

  it('does not wake after the session is disposed', async () => {
    const notices = source()
    const intake = new MessageIntake({ sources: [notices.input] })
    let wakes = 0
    intake.register({ threadId: MAIN, driver: { blocked: () => false, wake: () => { wakes += 1 } } })
    notices.enqueue({ threadId: MAIN, draft: said('report') })
    intake.dispose()
    await flush()
    expect(wakes).toBe(0)
  })
})
