import { describe, expect, it } from 'bun:test'

import { createMarkReadScheduler } from '../mark-read-scheduler'
import type { Schedule } from '../thread-signals'

function harness(send?: (seq: number) => Promise<unknown>) {
  const sent: number[] = []
  const tasks: Array<{ delayMs: number; run: () => void; cancelled: boolean }> = []
  const schedule: Schedule = ({ delayMs, run }) => {
    const task = { delayMs, run, cancelled: false }
    tasks.push(task)
    return () => {
      task.cancelled = true
    }
  }
  const scheduler = createMarkReadScheduler({
    schedule,
    send:
      send ??
      ((seq) => {
        sent.push(seq)
        return Promise.resolve()
      }),
  })
  const fire = () => {
    for (const task of tasks.splice(0)) if (!task.cancelled) task.run()
  }
  return { scheduler, sent, tasks, fire }
}

describe('createMarkReadScheduler', () => {
  it('coalesces pushes within the window and sends the max head', () => {
    const { scheduler, sent, tasks, fire } = harness()
    scheduler.push(3)
    scheduler.push(7)
    scheduler.push(5)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.delayMs).toBe(1000)
    fire()
    expect(sent).toEqual([7])
  })

  it('skips a seq already sent', () => {
    const { scheduler, sent, tasks, fire } = harness()
    scheduler.push(4)
    fire()
    scheduler.push(4)
    scheduler.push(2)
    expect(tasks).toHaveLength(0)
    scheduler.push(6)
    fire()
    expect(sent).toEqual([4, 6])
  })

  it('swallows send errors', async () => {
    const { scheduler, fire } = harness(() => Promise.reject(new Error('boom')))
    scheduler.push(1)
    fire()
    await Promise.resolve()
    expect(true).toBe(true)
  })

  it('stop cancels the pending send', () => {
    const { scheduler, sent, fire } = harness()
    scheduler.push(9)
    scheduler.stop()
    fire()
    expect(sent).toEqual([])
  })
})
