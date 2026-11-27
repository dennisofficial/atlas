import { describe, expect, test } from 'bun:test'

import {
  CHIP_RADIUS,
  CHIP_REMOVE_INSET,
  CHIP_REMOVE_SIZE,
  COMPOSER_INSET,
  COMPOSER_RADIUS,
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
})
