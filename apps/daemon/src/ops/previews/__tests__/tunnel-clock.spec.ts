import { describe, expect, it } from 'bun:test'

import { EPreviewRedialReason } from '@dltech/atlas-protocol'

import { TunnelClock } from '../tunnel-clock'

const clockOf = () => {
  const time = { wall: 100_000, monotonic: 1_000 }
  const clock = new TunnelClock({ wallNow: () => time.wall, monotonicNow: () => time.monotonic })
  return { time, clock }
}

describe('TunnelClock.suspendGap', () => {
  it('reports wall gap and freeze skew at the freeze threshold', () => {
    const { time, clock } = clockOf()
    time.wall += 3_000
    time.monotonic += 1_000
    expect(clock.suspendGap()).toEqual({
      reason: EPreviewRedialReason.Freeze,
      gapMs: 3_000,
      skewMs: 2_000,
    })
    expect(clock.suspendGap()).toBeUndefined()
  })

  it('reports a long gap when both clocks advance equally', () => {
    const { time, clock } = clockOf()
    time.wall += 30_000
    time.monotonic += 30_000
    expect(clock.suspendGap()).toEqual({
      reason: EPreviewRedialReason.Gap,
      gapMs: 30_000,
      skewMs: 0,
    })
  })

  it('ignores clock jitter and short event loop stalls', () => {
    const { time, clock } = clockOf()
    time.wall += 6_000
    time.monotonic += 6_000
    expect(clock.suspendGap()).toBeUndefined()
    time.wall += 2_999
    time.monotonic += 1_000
    expect(clock.suspendGap()).toBeUndefined()
  })
})
