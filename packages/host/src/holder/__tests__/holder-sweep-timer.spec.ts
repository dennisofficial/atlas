import { describe, expect, it } from 'bun:test'

import { HolderSweep } from '../holder-sweep'
import { FakeClock } from './rig-fakes'

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('HolderSweep', () => {
  it('does not start a second tick while one is running', async () => {
    const clock = new FakeClock()
    let started = 0
    let release: () => void = () => undefined
    const sweep = new HolderSweep({
      timers: clock,
      intervalMs: 1_000,
      tick: () => {
        started += 1
        return new Promise<void>((resolve) => {
          release = resolve
        })
      },
    })
    sweep.start()
    clock.advance(1_000)
    await settle()
    expect(started).toBe(1)
    clock.advance(10_000)
    await settle()
    expect(started).toBe(1)
    release()
    await settle()
    clock.advance(1_000)
    await settle()
    expect(started).toBe(2)
    sweep.stop()
  })

  it('keeps ticking after a tick throws and applies jitter to the delay', async () => {
    const delays: number[] = []
    const clock = new FakeClock()
    const randoms = [0, 1]
    clock.random = () => randoms.shift() ?? 0.5
    const setTimeout = clock.setTimeout.bind(clock)
    clock.setTimeout = (handler, ms) => {
      delays.push(ms)
      return setTimeout(handler, ms)
    }
    let started = 0
    const sweep = new HolderSweep({
      timers: clock,
      intervalMs: 1_000,
      tick: async () => {
        started += 1
        throw new Error('boom')
      },
    })
    sweep.start()
    clock.advance(800)
    await settle()
    clock.advance(1_200)
    await settle()
    expect(started).toBe(2)
    expect(delays.slice(0, 2)).toEqual([800, 1_200])
    sweep.stop()
  })
})
