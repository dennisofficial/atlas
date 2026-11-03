import { describe, expect, it } from 'bun:test'

import { EColorScheme, semantic } from '@dltech/atlas-ui/tokens'

import { resolveTheme } from '../resolve-theme'

describe('resolveTheme', () => {
  it('maps dark scheme to the dark semantic tokens', () => {
    expect(resolveTheme({ scheme: 'dark' })).toBe(semantic[EColorScheme.Dark])
  })

  it('maps light scheme to the light semantic tokens', () => {
    expect(resolveTheme({ scheme: 'light' })).toBe(semantic[EColorScheme.Light])
  })

  it('falls back to light when the scheme is unset', () => {
    expect(resolveTheme({ scheme: null })).toBe(semantic[EColorScheme.Light])
    expect(resolveTheme({ scheme: undefined })).toBe(semantic[EColorScheme.Light])
  })

  it('exposes only hex color strings React Native accepts', () => {
    for (const theme of [semantic[EColorScheme.Dark], semantic[EColorScheme.Light]]) {
      for (const value of Object.values(theme)) {
        expect(value).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i)
      }
    }
  })
})
