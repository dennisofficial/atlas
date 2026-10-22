import {
  ATLAS_SETTINGS,
  ESettingId,
  ESettingsLayer,
  resolveSettings,
  type SettingValue,
} from '@dltech/atlas-core'
import { afterEach, describe, expect, it } from 'vitest'

import { accentHex } from '../accents'
import { appearanceOf, applyAppearance, SHIPPED_ACCENT } from '../appearance'
import { imageRows, SHIPPED_IMAGE_ROWS } from '../image-rows-store'
import { applyFenceWrap, EFenceWrap, fenceWrap, SHIPPED_FENCE_WRAP } from '../fence-wrap-store'
import {
  applyComposerEdge,
  composerEdge,
  EComposerEdge,
  SHIPPED_COMPOSER_EDGE,
} from '../composer-edge-store'
import { applyLogo, ELogo, logo, SHIPPED_LOGO } from '../logo-store'
import { applyBlockDensity, blockDensity, EBlockDensity, SHIPPED_DENSITY } from '../density-store'
import { paletteVersion, resetPalette, subscribePalette } from '../palette-store'
import { theme } from '../theme'

afterEach(() => {
  resetPalette()
  applyBlockDensity(SHIPPED_DENSITY)
  applyComposerEdge(SHIPPED_COMPOSER_EDGE)
  applyFenceWrap(SHIPPED_FENCE_WRAP)
  applyLogo(SHIPPED_LOGO)
})

const resolutionOf = (values: Record<string, SettingValue>) =>
  resolveSettings({
    definitions: ATLAS_SETTINGS,
    layers: [{ layer: ESettingsLayer.User, origin: 'a settings file', values }],
  })

describe('appearanceOf', () => {
  it('reads the shipped look when nothing has been chosen', () => {
    expect(appearanceOf({ resolution: resolutionOf({}) })).toEqual({
      accent: SHIPPED_ACCENT,
      density: SHIPPED_DENSITY,
      composer: SHIPPED_COMPOSER_EDGE,
      imageRows: SHIPPED_IMAGE_ROWS,
      fenceWrap: SHIPPED_FENCE_WRAP,
      logo: SHIPPED_LOGO,
    })
  })

  it('reads what the settings actually hold', () => {
    const resolution = resolutionOf({
      [ESettingId.Accent]: 'moss',
      [ESettingId.BlockPadding]: 'compact',
      [ESettingId.ComposerEdge]: 'bordered',
      [ESettingId.ImageRows]: 48,
      [ESettingId.FenceWrap]: 'never',
      [ESettingId.Logo]: 'wordmark',
    })

    expect(appearanceOf({ resolution })).toEqual({
      accent: 'moss',
      density: EBlockDensity.Compact,
      composer: EComposerEdge.Bordered,
      imageRows: 48,
      fenceWrap: EFenceWrap.Never,
      logo: ELogo.Wordmark,
    })
  })
})

describe('applyAppearance', () => {
  it('moves the whole palette onto the chosen accent', () => {
    applyAppearance({
      accent: 'moss',
      density: SHIPPED_DENSITY,
      composer: SHIPPED_COMPOSER_EDGE,
      imageRows: SHIPPED_IMAGE_ROWS,
      fenceWrap: SHIPPED_FENCE_WRAP,
      logo: SHIPPED_LOGO,
    })

    expect(theme.accent).toBe(accentHex('moss'))
    expect(theme.codeInline).toBe(accentHex('moss'))
    expect(theme.court.agent).toBe(accentHex('moss'))
  })

  it('moves the composer edge', () => {
    applyAppearance({
      accent: SHIPPED_ACCENT,
      density: SHIPPED_DENSITY,
      composer: EComposerEdge.Bordered,
      imageRows: SHIPPED_IMAGE_ROWS,
      fenceWrap: SHIPPED_FENCE_WRAP,
      logo: SHIPPED_LOGO,
    })
    expect(composerEdge()).toBe(EComposerEdge.Bordered)
  })

  it('moves the density', () => {
    applyAppearance({
      accent: SHIPPED_ACCENT,
      density: EBlockDensity.Compact,
      composer: SHIPPED_COMPOSER_EDGE,
      imageRows: SHIPPED_IMAGE_ROWS,
      fenceWrap: SHIPPED_FENCE_WRAP,
      logo: SHIPPED_LOGO,
    })
    expect(blockDensity()).toBe(EBlockDensity.Compact)
  })

  it('repaints nothing when the look is already the one asked for', () => {
    applyAppearance({
      accent: 'moss',
      density: EBlockDensity.Compact,
      composer: SHIPPED_COMPOSER_EDGE,
      imageRows: SHIPPED_IMAGE_ROWS,
      fenceWrap: SHIPPED_FENCE_WRAP,
      logo: SHIPPED_LOGO,
    })

    const before = paletteVersion()
    let repaints = 0
    const unsubscribe = subscribePalette(() => {
      repaints += 1
    })

    applyAppearance({
      accent: 'moss',
      density: EBlockDensity.Compact,
      composer: SHIPPED_COMPOSER_EDGE,
      imageRows: SHIPPED_IMAGE_ROWS,
      fenceWrap: SHIPPED_FENCE_WRAP,
      logo: SHIPPED_LOGO,
    })
    unsubscribe()

    expect(paletteVersion()).toBe(before)
    expect(repaints).toBe(0)
  })
})

describe('applyImageRows', () => {
  it('carries the chosen height to the transcript, since a taller box is a sharper picture', () => {
    applyAppearance({
      accent: SHIPPED_ACCENT,
      density: SHIPPED_DENSITY,
      composer: SHIPPED_COMPOSER_EDGE,
      imageRows: 64,
      fenceWrap: SHIPPED_FENCE_WRAP,
      logo: SHIPPED_LOGO,
    })

    expect(imageRows()).toBe(64)
  })
})

describe('applyFenceWrap', () => {
  it('carries the chosen wrap to the fences', () => {
    applyAppearance({
      accent: SHIPPED_ACCENT,
      density: SHIPPED_DENSITY,
      composer: SHIPPED_COMPOSER_EDGE,
      imageRows: SHIPPED_IMAGE_ROWS,
      fenceWrap: EFenceWrap.Never,
      logo: SHIPPED_LOGO,
    })

    expect(fenceWrap()).toBe(EFenceWrap.Never)
  })
})

describe('applyLogo', () => {
  it('carries the chosen logo to the home and boot screens', () => {
    applyAppearance({
      accent: SHIPPED_ACCENT,
      density: SHIPPED_DENSITY,
      composer: SHIPPED_COMPOSER_EDGE,
      imageRows: SHIPPED_IMAGE_ROWS,
      fenceWrap: SHIPPED_FENCE_WRAP,
      logo: ELogo.Wordmark,
    })

    expect(logo()).toBe(ELogo.Wordmark)
  })
})
