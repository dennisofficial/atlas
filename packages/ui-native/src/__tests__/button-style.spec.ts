import { describe, expect, test } from 'bun:test'

import { EColorScheme, semantic } from '@dltech/atlas-ui/tokens'

import { EButtonVariant, buttonColorsOf } from '../button-style'

const theme = semantic[EColorScheme.Light]

describe('buttonColorsOf when disabled', () => {
  test('a filled variant turns to the muted fill with a muted label', () => {
    for (const variant of [
      EButtonVariant.Default,
      EButtonVariant.Secondary,
      EButtonVariant.Destructive,
    ]) {
      expect(
        buttonColorsOf({ variant, theme, dark: false, pressed: false, disabled: true }),
      ).toEqual({
        background: theme.muted,
        foreground: theme.mutedForeground,
        border: 'transparent',
      })
    }
  })

  test('an unfilled variant keeps its surface and only mutes the label', () => {
    const enabled = buttonColorsOf({
      variant: EButtonVariant.Outline,
      theme,
      dark: false,
      pressed: false,
    })
    const disabled = buttonColorsOf({
      variant: EButtonVariant.Outline,
      theme,
      dark: false,
      pressed: true,
      disabled: true,
    })
    expect(disabled).toEqual({ ...enabled, foreground: theme.mutedForeground })
  })

  test('an enabled button keeps its variant colours', () => {
    expect(
      buttonColorsOf({ variant: EButtonVariant.Default, theme, dark: false, pressed: false }),
    ).toEqual({
      background: theme.primary,
      foreground: theme.primaryForeground,
      border: 'transparent',
    })
  })
})
