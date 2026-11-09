import { describe, expect, test } from 'bun:test'

import { EColorScheme, semantic } from '@dltech/atlas-ui/tokens'

import { withAlpha } from '../color'
import {
  EFontFamily,
  EFontWeight,
  ETextRole,
  ETextTone,
  textStyleOf,
  toneColorOf,
} from '../text-style'
import { resolveTheme, schemeOf } from '../theme'

describe('withAlpha', () => {
  test('appends an alpha channel to a six-digit hex', () => {
    expect(withAlpha({ color: '#d97757', alpha: 0.8 })).toBe('#d97757cc')
    expect(withAlpha({ color: '#000000', alpha: 0 })).toBe('#00000000')
  })

  test('leaves colours it cannot parse untouched', () => {
    expect(withAlpha({ color: 'rgba(0,0,0,1)', alpha: 0.5 })).toBe('rgba(0,0,0,1)')
  })
})

describe('textStyleOf', () => {
  test('maps a role and face onto the shared type scale and font faces', () => {
    expect(
      textStyleOf({
        role: ETextRole.Sm,
        family: EFontFamily.Mono,
        weight: EFontWeight.Regular,
        tight: false,
      }),
    ).toEqual({
      fontSize: 14,
      lineHeight: 20,
      fontFamily: 'JetBrainsMono_400Regular',
      letterSpacing: 0,
    })
  })

  test('a relaxed leading scales the line box to the web value', () => {
    const style = textStyleOf({
      role: ETextRole.Sm,
      family: EFontFamily.Sans,
      weight: EFontWeight.Regular,
      tight: false,
      leading: 1.625,
    })
    expect(style.fontSize).toBe(14)
    expect(style.lineHeight).toBeCloseTo(22.75)
  })

  test('tight tracking is -0.025em, as Tailwind tracking-tight', () => {
    const style = textStyleOf({
      role: ETextRole.Xl,
      family: EFontFamily.Sans,
      weight: EFontWeight.Medium,
      tight: true,
    })
    expect(style.letterSpacing).toBeCloseTo(-0.5)
  })
})

describe('theme', () => {
  test('follows the system scheme and falls back to light', () => {
    expect(schemeOf('dark')).toBe(EColorScheme.Dark)
    expect(schemeOf(null)).toBe(EColorScheme.Light)
    expect(resolveTheme('dark')).toBe(semantic[EColorScheme.Dark])
  })

  test('tones resolve to semantic colours', () => {
    const theme = semantic[EColorScheme.Dark]
    expect(toneColorOf({ tone: ETextTone.Muted, theme })).toBe(theme.mutedForeground)
    expect(toneColorOf({ tone: ETextTone.OnPrimary, theme })).toBe(theme.primaryForeground)
  })
})
