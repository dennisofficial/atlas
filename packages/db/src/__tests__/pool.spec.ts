import { describe, expect, it } from 'bun:test'
import { poolMaxOf } from '../pool'

describe('poolMaxOf', () => {
  it('defaults to ten when unset', () => {
    expect(poolMaxOf(undefined)).toBe(10)
  })

  it('honours a positive integer override', () => {
    expect(poolMaxOf('4')).toBe(4)
  })

  it('ignores values that are not positive integers', () => {
    for (const raw of ['', '0', '-2', '2.5', 'ten']) expect(poolMaxOf(raw)).toBe(10)
  })
})
