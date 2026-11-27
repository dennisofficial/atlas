import { describe, expect, it } from 'bun:test'

import { EDensity, ETheme } from '@dltech/atlas-wire/web'

import { appearanceChanges, appearanceFrom, colorSchemeOf } from '../appearance'

describe('appearanceFrom', () => {
  it('reads the dark palette when nothing is stored', () => {
    expect(appearanceFrom(new Map())).toEqual({
      theme: ETheme.Dark,
      density: EDensity.Comfortable,
      codeFontSize: 13,
      showDiffStat: true,
      reduceMotion: false,
    })
  })

  it('reads a stored palette and display settings', () => {
    const values = new Map<string, string | number | boolean>([
      ['web.appearance.theme', ETheme.Light],
      ['web.appearance.density', EDensity.Compact],
      ['web.appearance.codeFontSize', 14],
      ['web.appearance.showDiffStat', true],
      ['web.appearance.reduceMotion', true],
    ])
    expect(appearanceFrom(values)).toEqual({
      theme: ETheme.Light,
      density: EDensity.Compact,
      codeFontSize: 14,
      showDiffStat: true,
      reduceMotion: true,
    })
  })

  it('falls back on a stored value outside the enum', () => {
    const values = new Map<string, string | number | boolean>([
      ['web.appearance.theme', 'sepia'],
      ['web.appearance.codeFontSize', 18],
    ])
    const settings = appearanceFrom(values)
    expect(settings.theme).toBe(ETheme.Dark)
    expect(settings.codeFontSize).toBe(13)
  })
})

describe('appearanceChanges', () => {
  it('writes only what changed', () => {
    const saved = appearanceFrom(new Map())
    expect(appearanceChanges({ saved, draft: { ...saved, theme: ETheme.System } })).toEqual({
      'web.appearance.theme': ETheme.System,
    })
  })

  it('writes nothing when the draft matches', () => {
    const saved = appearanceFrom(new Map())
    expect(appearanceChanges({ saved, draft: saved })).toEqual({})
  })
})

describe('colorSchemeOf', () => {
  it('maps the theme to the scheme to apply', () => {
    expect(colorSchemeOf(ETheme.Dark)).toBe('dark')
    expect(colorSchemeOf(ETheme.Light)).toBe('light')
    expect(colorSchemeOf(ETheme.System)).toBe('unspecified')
  })
})
