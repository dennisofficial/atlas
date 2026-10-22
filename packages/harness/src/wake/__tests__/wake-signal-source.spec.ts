import { describe, expect, it } from 'bun:test'

import type { ClockJump } from '../clock-jump-detector'
import { WakeSignalSource } from '../wake-signal-source'

describe('a wake signal source', () => {
  it('forwards a fired jump to subscribers', () => {
    const source = new WakeSignalSource()
    const gaps: number[] = []
    source.subscribe((jump) => gaps.push(jump.gapMs))

    const jump: ClockJump = { gapMs: 90_000 }
    source.fire(jump)

    expect(gaps).toEqual([90_000])
  })

  it('answers how long ago the last jump fired', () => {
    let nowMs = 0
    const source = new WakeSignalSource({ now: () => nowMs })

    expect(source.wasWakeRecent(60_000)).toBe(false)

    source.fire({ gapMs: 90_000 })
    expect(source.wasWakeRecent(60_000)).toBe(true)

    nowMs = 59_999
    expect(source.wasWakeRecent(60_000)).toBe(true)

    nowMs = 60_001
    expect(source.wasWakeRecent(60_000)).toBe(false)
  })

  it('keeps the latest jump when several fire', () => {
    let nowMs = 0
    const source = new WakeSignalSource({ now: () => nowMs })

    source.fire({ gapMs: 90_000 })
    nowMs = 120_000
    expect(source.wasWakeRecent(60_000)).toBe(false)

    source.fire({ gapMs: 120_000 })
    expect(source.wasWakeRecent(60_000)).toBe(true)
  })
})
