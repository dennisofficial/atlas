import { describe, expect, it, vi } from 'vitest'
import { registerGracefulShutdown } from './graceful-shutdown'

type SignalHandler = () => void

const capture = () => {
  const handlers = new Map<string, SignalHandler>()
  return {
    handlers,
    listen: (signal: 'SIGTERM' | 'SIGINT', handler: SignalHandler) => {
      handlers.set(signal, handler)
    },
  }
}

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve()
  }
}

describe('registerGracefulShutdown', () => {
  it('drains on SIGTERM and only closes after the drain delay', async () => {
    const { handlers, listen } = capture()
    const order: string[] = []
    const sleepFn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          order.push('sleep')
          resolve()
        }),
    )
    registerGracefulShutdown({
      beginDrain: () => order.push('drain'),
      closeApp: async () => {
        order.push('close')
      },
      exitProcess: () => order.push('exit'),
      sleepFn,
      drainDelayMs: 1000,
      forceExitMs: 60_000,
      listen,
      writeLog: () => {},
    })

    handlers.get('SIGTERM')!()
    expect(order).toEqual(['drain', 'sleep'])
    await flushMicrotasks()
    expect(order).toEqual(['drain', 'sleep', 'close', 'exit'])
    expect(sleepFn).toHaveBeenCalledWith(1000)
  })

  it('closes immediately on SIGINT without draining', async () => {
    const { handlers, listen } = capture()
    const order: string[] = []
    const sleepFn = vi.fn(() => Promise.resolve())
    registerGracefulShutdown({
      beginDrain: () => order.push('drain'),
      closeApp: async () => {
        order.push('close')
      },
      exitProcess: () => order.push('exit'),
      sleepFn,
      drainDelayMs: 1000,
      forceExitMs: 60_000,
      listen,
      writeLog: () => {},
    })

    handlers.get('SIGINT')!()
    await flushMicrotasks()
    expect(order).toEqual(['close', 'exit'])
    expect(sleepFn).not.toHaveBeenCalled()
  })

  it('ignores a second signal while shutdown is underway', async () => {
    const { handlers, listen } = capture()
    let drains = 0
    registerGracefulShutdown({
      beginDrain: () => {
        drains += 1
      },
      closeApp: async () => {},
      exitProcess: () => {},
      sleepFn: () => new Promise<void>(() => {}),
      drainDelayMs: 1000,
      forceExitMs: 60_000,
      listen,
      writeLog: () => {},
    })

    handlers.get('SIGTERM')!()
    handlers.get('SIGTERM')!()
    handlers.get('SIGINT')!()
    expect(drains).toBe(1)
  })

  it('force-exits when the close hangs past the deadline', async () => {
    vi.useFakeTimers()
    try {
      const { handlers, listen } = capture()
      let exited = false
      registerGracefulShutdown({
        beginDrain: () => {},
        closeApp: () => new Promise<void>(() => {}),
        exitProcess: () => {
          exited = true
        },
        drainDelayMs: 0,
        forceExitMs: 115_000,
        listen,
        writeLog: () => {},
      })

      handlers.get('SIGINT')!()
      await vi.advanceTimersByTimeAsync(115_000)
      expect(exited).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
