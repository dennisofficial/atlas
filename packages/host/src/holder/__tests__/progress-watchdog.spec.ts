import { describe, expect, it } from 'bun:test'

import { ProgressWatchdog } from '../progress-watchdog'
import { FakeClock } from './rig-fakes'

const STALL_MS = 1_000

const watchdogOf = (clock: FakeClock): { watchdog: ProgressWatchdog; stalls: number[] } => {
  const stalls: number[] = []
  const watchdog = new ProgressWatchdog({
    timers: clock,
    stallAfterMs: STALL_MS,
    onStall: (stalledForMs) => stalls.push(stalledForMs),
  })
  return { watchdog, stalls }
}

describe('ProgressWatchdog', () => {
  it('creates no timer until armed', () => {
    const clock = new FakeClock()
    const { watchdog } = watchdogOf(clock)
    watchdog.touch()
    expect(clock.pendingCount()).toBe(0)
  })

  it('does not fire before the bound and fires once at it', () => {
    const clock = new FakeClock()
    const { watchdog, stalls } = watchdogOf(clock)
    watchdog.arm()
    clock.advance(STALL_MS - 1)
    expect(stalls).toEqual([])
    clock.advance(1)
    expect(stalls).toEqual([STALL_MS])
    clock.advance(10 * STALL_MS)
    expect(stalls).toEqual([STALL_MS])
  })

  it('a touch pushes the deadline out', () => {
    const clock = new FakeClock()
    const { watchdog, stalls } = watchdogOf(clock)
    watchdog.arm()
    clock.advance(STALL_MS - 1)
    watchdog.touch()
    clock.advance(STALL_MS - 1)
    expect(stalls).toEqual([])
    clock.advance(1)
    expect(stalls.length).toBe(1)
  })

  it('a touch after the stall does not re-arm it', () => {
    const clock = new FakeClock()
    const { watchdog, stalls } = watchdogOf(clock)
    watchdog.arm()
    clock.advance(STALL_MS)
    watchdog.touch()
    expect(clock.pendingCount()).toBe(0)
    clock.advance(STALL_MS)
    expect(stalls.length).toBe(1)
  })

  it('disarm cancels the timer and later touches stay inert', () => {
    const clock = new FakeClock()
    const { watchdog, stalls } = watchdogOf(clock)
    watchdog.arm()
    watchdog.disarm()
    watchdog.touch()
    expect(clock.pendingCount()).toBe(0)
    clock.advance(10 * STALL_MS)
    expect(stalls).toEqual([])
  })

  it('a hold clears the timer and a release restarts the window', () => {
    const clock = new FakeClock()
    const { watchdog, stalls } = watchdogOf(clock)
    watchdog.arm()
    clock.advance(STALL_MS - 1)
    watchdog.hold()
    expect(clock.pendingCount()).toBe(0)
    clock.advance(10 * STALL_MS)
    expect(stalls).toEqual([])
    watchdog.release()
    clock.advance(STALL_MS - 1)
    expect(stalls).toEqual([])
    clock.advance(1)
    expect(stalls).toEqual([STALL_MS])
  })

  it('an arm while held waits for the release', () => {
    const clock = new FakeClock()
    const { watchdog, stalls } = watchdogOf(clock)
    watchdog.hold()
    watchdog.arm()
    expect(clock.pendingCount()).toBe(0)
    watchdog.release()
    clock.advance(STALL_MS)
    expect(stalls.length).toBe(1)
  })

  it('nested holds and a repeated release leave one window', () => {
    const clock = new FakeClock()
    const { watchdog, stalls } = watchdogOf(clock)
    watchdog.arm()
    watchdog.hold()
    watchdog.hold()
    watchdog.release()
    expect(clock.pendingCount()).toBe(0)
    watchdog.release()
    watchdog.release()
    clock.advance(STALL_MS)
    expect(stalls.length).toBe(1)
  })

  it('arming again after a stall fires once more', () => {
    const clock = new FakeClock()
    const { watchdog, stalls } = watchdogOf(clock)
    watchdog.arm()
    clock.advance(STALL_MS)
    watchdog.arm()
    clock.advance(STALL_MS)
    expect(stalls.length).toBe(2)
  })
})
