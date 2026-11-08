import { describe, expect, it } from 'bun:test'

import { LogPort } from '@dltech/atlas-observability'

import { createGracefulShutdown } from '../graceful-shutdown'

class MemoryLog extends LogPort {
  readonly messages: string[] = []
  record(entry: Parameters<LogPort['record']>[0]): void {
    this.messages.push(entry.message)
  }
}

type FakeTimer = { fn: () => void; ms: number; cleared: boolean }

const fakeTimers = () => {
  const timers: FakeTimer[] = []
  return {
    timers,
    setTimeout: (fn: () => void, ms: number): unknown => {
      const timer = { fn, ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimeout: (timer: unknown): void => {
      ;(timer as FakeTimer).cleared = true
    },
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))

describe('createGracefulShutdown', () => {
  it('drains once and exits 0 when the signal repeats mid-drain', async () => {
    let release: () => void = () => {}
    let drains = 0
    const exits: number[] = []
    const handleSignal = createGracefulShutdown({
      drain: () => {
        drains += 1
        return new Promise<void>((resolve) => {
          release = resolve
        })
      },
      exit: (code) => exits.push(code),
      log: new MemoryLog(),
      hardExitAfterMs: 1000,
      ...fakeTimers(),
    })
    handleSignal()
    handleSignal()
    handleSignal()
    await settle()
    expect(exits).toEqual([])
    release()
    await settle()
    expect(drains).toBe(1)
    expect(exits).toEqual([0])
  })

  it('exits 1 when the drain fails', async () => {
    const exits: number[] = []
    const log = new MemoryLog()
    createGracefulShutdown({
      drain: () => Promise.reject(new Error('boom')),
      exit: (code) => exits.push(code),
      log,
      hardExitAfterMs: 1000,
      ...fakeTimers(),
    })()
    await settle()
    expect(exits).toEqual([1])
    expect(log.messages).toContain('shutdown failed')
  })

  it('exits 1 once with a warning when the drain never settles', async () => {
    const exits: number[] = []
    const log = new MemoryLog()
    const clock = fakeTimers()
    createGracefulShutdown({
      drain: () => new Promise<void>(() => {}),
      exit: (code) => exits.push(code),
      log,
      hardExitAfterMs: 1234,
      ...clock,
    })()
    expect(clock.timers.map((timer) => timer.ms)).toEqual([1234])
    clock.timers[0]?.fn()
    await settle()
    expect(exits).toEqual([1])
    expect(log.messages).toContain('hard exit: the drain did not finish in 1234ms')
  })

  it('clears the timer when the drain finishes or fails', async () => {
    for (const drain of [() => Promise.resolve(), () => Promise.reject(new Error('boom'))]) {
      const clock = fakeTimers()
      createGracefulShutdown({
        drain,
        exit: () => {},
        log: new MemoryLog(),
        hardExitAfterMs: 1000,
        ...clock,
      })()
      await settle()
      expect(clock.timers.map((timer) => timer.cleared)).toEqual([true])
    }
  })
})
