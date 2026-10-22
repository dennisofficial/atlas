import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import { createPendingQueues } from '../../pending'
import { MessageIntake } from '../message-intake'
import { operatorSource } from '../sources'

const THREAD = toThreadId('owner')
const OTHER = toThreadId('other')
const flush = async (): Promise<void> => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}
const fixture = () => {
  const pending = createPendingQueues()
  const intake = new MessageIntake({ sources: [operatorSource(pending)] })
  return { pending, intake }
}

describe('intake activity', () => {
  it('is busy while a prepare reservation is held and idle once it settles', async () => {
    const { intake } = fixture()
    expect(intake.busy()).toBe(false)
    const held = await intake.prepare({ threadId: THREAD })
    expect(intake.busy()).toBe(true)
    held.release?.()
    await flush()
    expect(intake.busy()).toBe(false)
    intake.dispose()
  })

  it('stays busy while a commit is blocked on its append', async () => {
    const { intake } = fixture()
    intake.submit({ threadId: THREAD, text: 'work' })
    await flush()
    let releaseAppend = (): void => undefined
    const gate = new Promise<void>((resolve) => { releaseAppend = resolve })
    const committing = intake.commit({ threadId: THREAD, append: () => gate })
    await flush()
    expect(intake.busy()).toBe(true)
    releaseAppend()
    await committing
    await flush()
    expect(intake.busy()).toBe(false)
    intake.dispose()
  })

  it('is busy from a submission until the queued recheck has run', async () => {
    const { intake } = fixture()
    intake.submit({ threadId: THREAD, text: 'queued' })
    expect(intake.busy()).toBe(true)
    await flush()
    expect(intake.busy()).toBe(false)
    intake.dispose()
  })

  it('is busy while a wake is in flight, and settles when it does', async () => {
    const { intake } = fixture()
    let finish = (): void => undefined
    const pendingWake = new Promise<void>((resolve) => { finish = resolve })
    let blocked = false
    intake.register({
      threadId: THREAD,
      driver: { blocked: () => blocked, wake: () => { blocked = true; return pendingWake } },
    })
    intake.submit({ threadId: THREAD, text: 'wake for this' })
    await flush()
    expect(intake.busy()).toBe(true)
    finish()
    await flush()
    expect(intake.busy()).toBe(false)
    intake.dispose()
  })

  it('counts a held driver only while its thread still has pending input', async () => {
    const { intake } = fixture()
    const release = intake.hold({ threadId: THREAD })
    expect(intake.busy()).toBe(false)
    intake.submit({ threadId: THREAD, text: 'queued while held' })
    await flush()
    expect(intake.busy()).toBe(true)
    release()
    await flush()
    expect(intake.busy()).toBe(false)
    intake.dispose()
  })

  it('does not count suspension itself as busy, and resume restarts scheduling', async () => {
    const { intake } = fixture()
    let wakes = 0
    intake.register({ threadId: THREAD, driver: { blocked: () => false, wake: () => { wakes += 1 } } })
    intake.suspend()
    intake.submit({ threadId: THREAD, text: 'held while parked' })
    await flush()
    expect(intake.busy()).toBe(false)
    expect(wakes).toBe(0)
    intake.resume()
    await flush()
    expect(wakes).toBeGreaterThanOrEqual(1)
    intake.dispose()
  })
})

describe('intake activity subscription', () => {
  it('emits on busy transitions, once per start and once per end', async () => {
    const { intake } = fixture()
    const seen: boolean[] = []
    intake.subscribe(() => seen.push(intake.busy()))
    const first = await intake.prepare({ threadId: THREAD })
    expect(seen).toEqual([true])
    const second = await intake.prepare({ threadId: OTHER })
    expect(seen).toEqual([true])
    first.acknowledge()
    expect(seen).toEqual([true])
    second.acknowledge()
    await flush()
    expect(seen[seen.length - 1]).toBe(false)
    intake.dispose()
  })

  it('stops emitting once bounded wake retries exhaust, rather than firing forever', async () => {
    const { intake } = fixture()
    const seen: boolean[] = []
    intake.subscribe(() => seen.push(intake.busy()))
    let wakes = 0
    intake.register({
      threadId: THREAD,
      driver: { blocked: () => false, wake: () => { wakes += 1; throw new Error('failed') } },
    })
    intake.submit({ threadId: THREAD, text: 'report' })
    await flush()
    expect(wakes).toBe(3)
    const settledAt = seen.length
    await flush()
    await flush()
    expect(seen).toHaveLength(settledAt)
    intake.dispose()
  })
})
