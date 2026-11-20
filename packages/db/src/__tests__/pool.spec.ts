import { describe, expect, it } from 'bun:test'
import { createPool, poolMaxOf } from '../pool'

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

describe('createPool minIdle', () => {
  it('maps minIdle onto the pg min option', async () => {
    const pool = createPool('postgres://unused@127.0.0.1:1/unused', { minIdle: 2 })
    expect(pool.options.min).toBe(2)
    await pool.end()
  })

  it('leaves min at zero when minIdle is unset', async () => {
    const pool = createPool('postgres://unused@127.0.0.1:1/unused')
    expect(pool.options.min).toBe(0)
    await pool.end()
  })
})
