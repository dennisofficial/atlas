import { describe, expect, test } from 'vitest'

import { cn } from '../utils'

describe('cn', () => {
  test('joins class names', () => {
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2')
  })

  test('drops falsy inputs', () => {
    expect(cn('px-4', false, undefined, 'py-2')).toBe('px-4 py-2')
  })

  test('later conflicting utilities win', () => {
    expect(cn('px-4', 'px-8')).toBe('px-8')
  })
})
