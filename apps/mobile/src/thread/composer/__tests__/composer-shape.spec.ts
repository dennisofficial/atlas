import { describe, expect, test } from 'bun:test'

import {
  CHIP_RADIUS,
  CHIP_REMOVE_INSET,
  CHIP_REMOVE_SIZE,
  CHIP_SIZE,
  CHIP_THUMB_INSET,
  CHIP_THUMB_RADIUS,
  CHIP_THUMB_SIZE,
  COMPOSER_DOCK_BOTTOM,
  COMPOSER_FOOTER_GAP,
  COMPOSER_FOOTER_HEIGHT,
  COMPOSER_FOOTER_RESERVE,
  COMPOSER_INSET,
  COMPOSER_ITEM_GAP,
  COMPOSER_RADIUS,
  COMPOSER_TRIGGER_INSET,
  concentricRadiusOf,
} from '../composer-shape'

describe('concentricRadiusOf', () => {
  test('takes the inset off the outer radius', () => {
    expect(concentricRadiusOf({ outer: 24, inset: 10 })).toBe(14)
  })

  test('squares the corner when the inset is deeper than the radius', () => {
    expect(concentricRadiusOf({ outer: 8, inset: 12 })).toBe(0)
  })
})

describe('composer shape', () => {
  test('curves a chip with the composer corner it sits in', () => {
    expect(CHIP_RADIUS + COMPOSER_INSET).toBe(COMPOSER_RADIUS)
  })

  test('curves the remove button with the chip corner it sits in', () => {
    expect(CHIP_REMOVE_SIZE / 2 + CHIP_REMOVE_INSET).toBe(CHIP_RADIUS)
  })

  test('centres a video thumbnail in the chip and curves it with the chip corner', () => {
    expect(CHIP_THUMB_SIZE + 2 * CHIP_THUMB_INSET).toBe(CHIP_SIZE)
    expect(CHIP_THUMB_RADIUS + CHIP_THUMB_INSET).toBe(CHIP_RADIUS)
  })
})

describe('COMPOSER_FOOTER_RESERVE', () => {
  test('the footer fits in the dock bottom plus the reserve', () => {
    expect(COMPOSER_DOCK_BOTTOM + COMPOSER_FOOTER_RESERVE).toBe(
      COMPOSER_FOOTER_GAP + COMPOSER_FOOTER_HEIGHT,
    )
  })
})

describe('COMPOSER_TRIGGER_INSET', () => {
  test('two neighbouring triggers sit one item gap apart, like the usage and context readings', () => {
    expect(2 * COMPOSER_TRIGGER_INSET).toBe(COMPOSER_ITEM_GAP)
  })
})
