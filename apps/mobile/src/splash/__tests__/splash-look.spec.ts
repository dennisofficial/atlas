import { describe, expect, it } from 'bun:test'

import { SPLASH_DARK_BACKGROUND, SPLASH_LIGHT_BACKGROUND, splashBackgroundOf } from '../splash-look'

describe('splashBackgroundOf', () => {
  it('matches the native splash in light mode so the hand-off has no flash', () => {
    expect(splashBackgroundOf({ dark: false })).toBe(SPLASH_LIGHT_BACKGROUND)
  })

  it('uses the dark sidebar colour in dark mode', () => {
    expect(splashBackgroundOf({ dark: true })).toBe(SPLASH_DARK_BACKGROUND)
  })
})
