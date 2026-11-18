import { describe, expect, it } from 'bun:test'

import { SIGN_WINDOW_MS, validUntilOf } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { PgMediaSigningWindows } from '../pg-media-signing-windows'

const testDb = useTestDatabase()
const windowStart = 5 * SIGN_WINDOW_MS
const validUntil = validUntilOf(windowStart)

describe('PgMediaSigningWindows', () => {
  it('finds nothing for a window nobody has issued', async () => {
    const windows = new PgMediaSigningWindows(testDb().db)
    expect(await windows.find(windowStart)).toBeNull()
  })

  it('stores a row and reads it back to the millisecond', async () => {
    const windows = new PgMediaSigningWindows(testDb().db)
    await windows.insertIfAbsent({ windowStart, validUntil, sealed: 'sealed-a' })
    expect(await windows.find(windowStart)).toEqual({ validUntil, sealed: 'sealed-a' })
  })

  it('keeps the first writer when a second insert hits the same window', async () => {
    const windows = new PgMediaSigningWindows(testDb().db)
    await windows.insertIfAbsent({ windowStart, validUntil, sealed: 'first' })
    await windows.insertIfAbsent({ windowStart, validUntil, sealed: 'second' })
    expect((await windows.find(windowStart))?.sealed).toBe('first')
  })

  it('keeps one row when inserts race', async () => {
    const windows = new PgMediaSigningWindows(testDb().db)
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((sealed) =>
        windows.insertIfAbsent({ windowStart, validUntil, sealed }),
      ),
    )
    const row = await windows.find(windowStart)
    expect(['a', 'b', 'c', 'd']).toContain(row?.sealed ?? '')
  })
})
