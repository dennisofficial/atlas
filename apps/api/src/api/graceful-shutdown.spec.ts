import { describe, expect, it, vi } from 'bun:test'
import { advanceTimersByTimeAsync } from '../../test/fake-timers'
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
  it('begins the drain on SIGTERM and closes straight after', async () => {
    const { handlers, listen } = capture()
    const order: string[] = []
    registerGracefulShutdown({
      beginDrain: () => order.push('drain'),
      closeApp: async () => {
        order.push('close')
      },
      exitProcess: () => order.push('exit'),
      forceExitMs: 60_000,
      listen,
      writeLog: () => {},
    })

    handlers.get('SIGTERM')!()
    expect(order).toEqual(['drain', 'close'])
    await flushMicrotasks()
    expect(order).toEqual(['drain', 'close', 'exit'])
  })

  it('closes immediately on SIGINT without draining', async () => {
    const { handlers, listen } = capture()
    const order: string[] = []
    registerGracefulShutdown({
      beginDrain: () => order.push('drain'),
      closeApp: async () => {
        order.push('close')
      },
      exitProcess: () => order.push('exit'),
      forceExitMs: 60_000,
      listen,
      writeLog: () => {},
    })

    handlers.get('SIGINT')!()
    await flushMicrotasks()
    expect(order).toEqual(['close', 'exit'])
    expect(order).not.toContain('drain')
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
        forceExitMs: 115_000,
        listen,
        writeLog: () => {},
      })

      handlers.get('SIGINT')!()
      await advanceTimersByTimeAsync(115_000)
      expect(exited).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
