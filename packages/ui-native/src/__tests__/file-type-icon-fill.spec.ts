import { describe, expect, test } from 'bun:test'
import { EIconPart, type IconPath } from '@dltech/atlas-ui/file-icons'

import { iconFillOf } from '../file-type-icon-fill'

const palette = { foreground: '#eaeaea', muted: '#a1a1a1' }
const path: IconPath = { d: 'M0 0h24v24H0z', fill: '#3178c6', part: EIconPart.Glyph }

describe('iconFillOf', () => {
  test('uses the muted theme colour for every monochrome path', () => {
    for (const part of [EIconPart.Body, EIconPart.Glyph]) {
      for (const fill of [null, '#3178c6']) {
        expect(iconFillOf({ path: { ...path, part, fill }, colored: false, ...palette })).toBe(
          palette.muted,
        )
      }
    }
  })

  test('preserves the source colour in colour mode', () => {
    expect(iconFillOf({ path, colored: true, ...palette })).toBe('#3178c6')
  })

  test('uses the foreground for a colour path without a source fill', () => {
    expect(iconFillOf({ path: { ...path, fill: null }, colored: true, ...palette })).toBe(
      palette.foreground,
    )
  })
})
