import { describe, expect, it } from 'bun:test'

import { Reconciler, reconcileBackoffMs } from '../reconciler'
import { FakeClock } from './rig-fakes'

const tick = async (times = 20): Promise<void> => {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('Reconciler', () => {
  it('ten requests during a step coalesce into exactly one extra step', async () => {
    const clock = new FakeClock()
    let steps = 0
    let resolveStep: (() => void) | undefined
    const reconciler = new Reconciler({
      timers: clock,
      step: () => {
        steps += 1
        return new Promise<void>((resolve) => {
          resolveStep = resolve
        })
      },
    })
    reconciler.request()
    for (let i = 0; i < 10; i += 1) reconciler.request()
    if (resolveStep === undefined) throw new Error('step never started')
    resolveStep()
    await tick()
    expect(steps).toBe(2)
  })

  it('requests made while no step runs start a step at once', async () => {
    const clock = new FakeClock()
    let steps = 0
    const reconciler = new Reconciler({
      timers: clock,
      step: () => {
        steps += 1
        return Promise.resolve()
      },
    })
    reconciler.request()
    await tick()
    reconciler.request()
    await tick()
    expect(steps).toBe(2)
  })

  it('a throwing step retries after a backoff and resets the backoff on success', async () => {
    const clock = new FakeClock()
    let steps = 0
    let failuresLeft = 2
    const errors: unknown[] = []
    const reconciler = new Reconciler({
      timers: clock,
      step: () => {
        steps += 1
        if (failuresLeft > 0) {
          failuresLeft -= 1
          return Promise.reject(new Error('read blew up'))
        }
        return Promise.resolve()
      },
      onError: (error) => {
        errors.push(error)
      },
    })
    reconciler.request()
    await tick()
    expect(steps).toBe(1)
    expect(errors.length).toBe(1)

    clock.advance(reconcileBackoffMs({ failures: 1 }))
    await tick()
    expect(steps).toBe(2)

    clock.advance(reconcileBackoffMs({ failures: 2 }))
    await tick()
    expect(steps).toBe(3)
    expect(errors.length).toBe(2)

    reconciler.request()
    await tick()
    expect(steps).toBe(4)
  })

  it('a step that keeps failing backs off up to the cap', async () => {
    const clock = new FakeClock()
    const firedAt: number[] = []
    const reconciler = new Reconciler({
      timers: clock,
      step: () => {
        firedAt.push(clock.now())
        return Promise.reject(new Error('down'))
      },
    })
    reconciler.request()
    await tick()
    for (const gap of [250, 500, 1_000, 2_000, 4_000, 5_000, 5_000]) {
      const before = firedAt.length
      clock.advance(gap - 1)
      await tick()
      expect(firedAt.length).toBe(before)
      clock.advance(1)
      await tick()
      expect(firedAt.length).toBe(before + 1)
    }
  })

  it('arms no timer while idle after a successful step', async () => {
    const clock = new FakeClock()
    const reconciler = new Reconciler({
      timers: clock,
      step: () => Promise.resolve(),
    })
    reconciler.request()
    await tick()
    expect(clock.pendingWithin(Number.MAX_SAFE_INTEGER)).toBe(false)
  })
})
