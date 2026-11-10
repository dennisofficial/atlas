import { describe, expect, it } from 'bun:test'

import { keyboardInsetOf } from '../keyboard-inset'

const frame = (screenY: number, height: number) => ({ screenX: 0, screenY, width: 390, height })

describe('keyboardInsetOf', () => {
  it('measures a keyboard docked to the bottom of the window', () => {
    expect(keyboardInsetOf({ frame: frame(478, 336), platform: 'ios', windowHeight: 814 })).toBe(
      336,
    )
  })

  it('ignores a floating keyboard that covers no bottom edge', () => {
    expect(keyboardInsetOf({ frame: frame(200, 280), platform: 'ios', windowHeight: 814 })).toBe(0)
  })

  it('ignores a keyboard that has slid off the bottom of the window', () => {
    expect(keyboardInsetOf({ frame: frame(814, 336), platform: 'ios', windowHeight: 814 })).toBe(0)
  })

  it('trusts a reported height on Android, where screenY marks the window bottom', () => {
    expect(
      keyboardInsetOf({ frame: frame(814, 320), platform: 'android', windowHeight: 814 }),
    ).toBe(320)
  })

  it('reports nothing when no keyboard is up', () => {
    expect(keyboardInsetOf({ frame: frame(0, 0), platform: 'ios', windowHeight: 814 })).toBe(0)
  })
})
