import { describe, expect, it } from 'bun:test'

import {
  ClockJumpDetector,
  DEFAULT_JUMP_THRESHOLD_MS,
  DEFAULT_TICK_MS,
  type IntervalHandle,
  type IntervalScheduler,
} from '../clock-jump-detector'

type FakeScheduler = IntervalScheduler & { fire: () => void; ticks: number }

const fakeScheduler = (): FakeScheduler => {
  let callback: (() => void) | null = null
  const scheduler: FakeScheduler = {
    ticks: 0,
    schedule(cb) {
      callback = cb
      this.ticks += 1
      return 1 as IntervalHandle
    },
    cancel() {
      callback = null
    },
    fire() {
      callback?.()
    },
  }
  return scheduler
}

const detectorAt = (args: { scheduler: FakeScheduler; startMs?: number }) => {
  let nowMs = args.startMs ?? 0
  const detector = new ClockJumpDetector({
    now: () => nowMs,
    intervals: args.scheduler,
  })
  return {
    detector,
    advance: (byMs: number) => {
      nowMs += byMs
    },
  }
}

describe('a clock jump detector', () => {
  it('fires subscribers with the measured gap when a tick lands past the threshold', () => {
    const scheduler = fakeScheduler()
    const { detector, advance } = detectorAt({ scheduler })
    const gaps: number[] = []
    detector.subscribe((jump) => gaps.push(jump.gapMs))

    detector.start()
    advance(DEFAULT_TICK_MS)
    scheduler.fire()
    advance(DEFAULT_TICK_MS + DEFAULT_JUMP_THRESHOLD_MS + 1)
    scheduler.fire()

    expect(gaps).toEqual([DEFAULT_TICK_MS + DEFAULT_JUMP_THRESHOLD_MS + 1])
  })

  it('stays quiet while ticks arrive roughly on time', () => {
    const scheduler = fakeScheduler()
    const { detector, advance } = detectorAt({ scheduler })
    let fired = false
    detector.subscribe(() => {
      fired = true
    })

    detector.start()
    for (let tick = 0; tick < 10; tick += 1) {
      advance(DEFAULT_TICK_MS + 500)
      scheduler.fire()
    }

    expect(fired).toBe(false)
  })

  it('does not arm the interval twice when started twice', () => {
    const scheduler = fakeScheduler()
    const { detector } = detectorAt({ scheduler })

    detector.start()
    detector.start()

    expect(scheduler.ticks).toBe(1)
  })

  it('stops measuring once stopped, and stops notifying anyone', () => {
    const scheduler = fakeScheduler()
    const { detector, advance } = detectorAt({ scheduler })
    let fired = false
    detector.subscribe(() => {
      fired = true
    })

    detector.start()
    detector.stop()
    advance(DEFAULT_TICK_MS + DEFAULT_JUMP_THRESHOLD_MS + 1)
    scheduler.fire()

    expect(fired).toBe(false)
  })

  it('unsubscribes a subscriber through the handle it was given', () => {
    const scheduler = fakeScheduler()
    const { detector, advance } = detectorAt({ scheduler })
    let fired = false
    const unsubscribe = detector.subscribe(() => {
      fired = true
    })

    detector.start()
    unsubscribe()
    advance(DEFAULT_TICK_MS + DEFAULT_JUMP_THRESHOLD_MS + 1)
    scheduler.fire()

    expect(fired).toBe(false)
  })

  it('notifies every subscriber on the same jump', () => {
    const scheduler = fakeScheduler()
    const { detector, advance } = detectorAt({ scheduler })
    let first = 0
    let second = 0
    detector.subscribe((jump) => {
      first = jump.gapMs
    })
    detector.subscribe((jump) => {
      second = jump.gapMs
    })

    detector.start()
    advance(DEFAULT_TICK_MS + DEFAULT_JUMP_THRESHOLD_MS + 1)
    scheduler.fire()

    expect(first).toBeGreaterThan(DEFAULT_JUMP_THRESHOLD_MS)
    expect(second).toBe(first)
  })

  it('treats the first tick after start as the baseline, never a jump', () => {
    const scheduler = fakeScheduler()
    let nowMs = 1_000_000
    const detector = new ClockJumpDetector({ now: () => nowMs, intervals: scheduler })
    let fired = false
    detector.subscribe(() => {
      fired = true
    })

    nowMs += 10 * DEFAULT_JUMP_THRESHOLD_MS
    detector.start()
    scheduler.fire()

    expect(fired).toBe(false)
  })

  it('honours an overridden tick and threshold', () => {
    const scheduler = fakeScheduler()
    let nowMs = 0
    const detector = new ClockJumpDetector({
      now: () => nowMs,
      intervals: scheduler,
      tickMs: 100,
      thresholdMs: 1_000,
    })
    const gaps: number[] = []
    detector.subscribe((jump) => gaps.push(jump.gapMs))

    detector.start()
    nowMs += 1_000
    scheduler.fire()
    nowMs += 50
    scheduler.fire()
    nowMs += 1_500
    scheduler.fire()

    expect(gaps).toEqual([1_500])
  })
})
