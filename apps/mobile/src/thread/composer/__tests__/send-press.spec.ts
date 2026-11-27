import { describe, expect, test } from 'bun:test'

import {
  CONTROLS_GAP,
  PRESSED_SCALE,
  PRESS_IN_SPRING,
  RELEASE_SPRING,
  dampingRatioOf,
  sendHitSlopOf,
} from '../send-press'

const DEFAULT_SLOP = 6

describe('sendHitSlopOf', () => {
  test('reaches up and left, where the thumb misses the button', () => {
    const slop = sendHitSlopOf({ besidePressable: false })
    expect(slop.top).toBeGreaterThan(DEFAULT_SLOP)
    expect(slop.left).toBeGreaterThan(DEFAULT_SLOP)
  })

  test('keeps the default slop down and right', () => {
    const slop = sendHitSlopOf({ besidePressable: false })
    expect(slop.bottom).toBe(DEFAULT_SLOP)
    expect(slop.right).toBe(DEFAULT_SLOP)
  })

  test('beside a pressable control, keeps the default slop on the left so taps still reach it', () => {
    const slop = sendHitSlopOf({ besidePressable: true })
    expect(slop.left).toBe(DEFAULT_SLOP)
    expect(slop.left).toBeLessThan(CONTROLS_GAP)
    expect(slop.top).toBeGreaterThan(DEFAULT_SLOP)
  })
})

describe('the press bounce', () => {
  test('grows a little while held', () => {
    expect(PRESSED_SCALE).toBeGreaterThan(1)
    expect(PRESSED_SCALE).toBeLessThanOrEqual(1.1)
  })

  test('bounces once as it grows, without ringing', () => {
    const ratio = dampingRatioOf(PRESS_IN_SPRING)
    expect(ratio).toBeGreaterThanOrEqual(0.55)
    expect(ratio).toBeLessThan(0.8)
  })

  test('settles back on release without overshoot', () => {
    expect(dampingRatioOf(RELEASE_SPRING)).toBeGreaterThanOrEqual(0.95)
  })
})
