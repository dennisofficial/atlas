import { expect } from 'vitest'

import { glyph } from '../glyphs'

export const HALF_CELL = '▀'

export const inkedCells = (painted: string): number => painted.split(HALF_CELL).length - 1

export function expectNoLogo(painted: string): void {
  expect(painted).not.toContain(HALF_CELL)
  expect(painted).not.toContain(glyph.block)
}
