import { describe, expect, it } from 'bun:test'

import { EColorScheme, semantic } from '@dltech/atlas-ui/tokens'

import appConfig from '../../../app.config'
import {
  SPLASH_DARK_BACKGROUND,
  SPLASH_LIGHT_BACKGROUND,
  SPLASH_MARK_DARK,
  SPLASH_MARK_LIGHT,
  splashBackgroundOf,
} from '../splash-look'

const nativeSplash = () => {
  const entry = appConfig().plugins?.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
  )
  if (!Array.isArray(entry)) throw new Error('no expo-splash-screen plugin')
  return entry[1] as {
    backgroundColor: string
    image: string
    dark: { backgroundColor: string; image: string }
  }
}

describe('splashBackgroundOf', () => {
  it('uses the sidebar colour of each scheme', () => {
    expect(splashBackgroundOf({ dark: false })).toBe(semantic[EColorScheme.Light].sidebar)
    expect(splashBackgroundOf({ dark: true })).toBe(semantic[EColorScheme.Dark].sidebar)
  })
})

describe('native splash', () => {
  it('matches the overlay so the hand-off has no flash', () => {
    const splash = nativeSplash()
    expect(splash.backgroundColor).toBe(SPLASH_LIGHT_BACKGROUND)
    expect(splash.dark.backgroundColor).toBe(SPLASH_DARK_BACKGROUND)
  })

  it('shows the mark in the accent of each scheme', () => {
    const splash = nativeSplash()
    expect(splash.image).toBe(SPLASH_MARK_LIGHT)
    expect(splash.dark.image).toBe(SPLASH_MARK_DARK)
  })
})
