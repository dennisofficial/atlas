import { describe, expect, it } from 'bun:test'

import type { Schedule } from '@/features/threads/data/thread-signals'

import { createListReloader, createListSignals, type ListSignalHandlers } from '../list-reload'

function fakeSchedule() {
  const tasks: Array<{ delayMs: number; run: () => void; live: boolean }> = []
  const schedule: Schedule = (task) => {
    const entry = { ...task, live: true }
    tasks.push(entry)
    return () => {
      entry.live = false
    }
  }
  const flush = () => {
    for (const task of tasks) {
      if (!task.live) continue
      task.live = false
      task.run()
    }
  }
  return { schedule, flush }
}

describe('createListReloader', () => {
  it('collapses frames inside the debounce window into one reload', () => {
    const timers = fakeSchedule()
    let reloads = 0
    const reloader = createListReloader({ reload: () => (reloads += 1), schedule: timers.schedule })

    reloader.handleFrame()
    reloader.handleFrame()
    reloader.handleFrame()
    expect(reloads).toBe(0)
    timers.flush()

    expect(reloads).toBe(1)
  })

  it('reloads again for a frame after the window', () => {
    const timers = fakeSchedule()
    let reloads = 0
    const reloader = createListReloader({ reload: () => (reloads += 1), schedule: timers.schedule })

    reloader.handleFrame()
    timers.flush()
    reloader.handleFrame()
    timers.flush()

    expect(reloads).toBe(2)
  })
})

describe('createListSignals', () => {
  it('reloads on reconnect but not on the first connect', () => {
    const timers = fakeSchedule()
    const handlers: ListSignalHandlers[] = []
    let reloads = 0
    const signals = createListSignals({
      subscribe: (given) => {
        handlers.push(given)
        return { unsubscribe: () => undefined }
      },
      reload: () => (reloads += 1),
      schedule: timers.schedule,
    })

    signals.start()
    handlers[0]?.onStarted()
    expect(reloads).toBe(0)
    handlers[0]?.onError(new Error('drop'))
    timers.flush()
    handlers[1]?.onStarted()

    expect(handlers).toHaveLength(2)
    expect(reloads).toBe(1)
  })
})
