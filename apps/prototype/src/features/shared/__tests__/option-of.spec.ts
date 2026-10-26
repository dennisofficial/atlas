import { describe, expect, test } from 'bun:test'

import { optionOf } from '../option-of'

const TABLE = { plain: 1, 'spicy-hot': 2 }

describe('optionOf', () => {
  test('returns the value stored under the key', () => {
    expect(optionOf({ table: TABLE, key: 'spicy-hot', fallback: 0 })).toBe(2)
  })

  test('falls back for unknown keys', () => {
    expect(optionOf({ table: TABLE, key: 'sweet', fallback: 0 })).toBe(0)
  })

  test('ignores inherited object properties', () => {
    expect(optionOf({ table: TABLE, key: 'toString', fallback: 0 })).toBe(0)
  })
})
