import { describe, expect, it } from 'bun:test'
import { access } from 'node:fs/promises'

import { parseProcStatStartTime, startTimeOf } from '../process-identity'

describe('parseProcStatStartTime', () => {
  it('reads field 22 from a plain stat line', () => {
    expect(
      parseProcStatStartTime(
        '1234 (atlas-serve) S 1 1234 1234 0 -1 4194304 100 0 0 0 25 5 0 0 20 0 4 0 987654 2000000 500 18446744073709551615 1 1 0 0 0 0',
      ),
    ).toBe('987654')
  })

  it('survives a comm containing spaces and parens', () => {
    expect(
      parseProcStatStartTime(
        '55 (weird (name) x) S 1 55 55 0 -1 4194304 10 0 0 0 1 0 0 0 20 0 1 0 42 1000 10 18446744073709551615 1 1 0 0',
      ),
    ).toBe('42')
  })

  it('rejects a line without a paren-wrapped comm', () => {
    expect(parseProcStatStartTime('1234 S 1 0 0')).toBeUndefined()
  })

  it('rejects a truncated line', () => {
    expect(parseProcStatStartTime('12 (x) S 1 2 3')).toBeUndefined()
  })

  it('rejects a non-numeric start field', () => {
    expect(
      parseProcStatStartTime('12 (x) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 notanumber 1 2 3'),
    ).toBeUndefined()
  })
})

describe('startTimeOf', () => {
  it('returns a start time from procfs when ps is absent and /proc exists', async () => {
    try {
      await access(`/proc/${process.pid}/stat`)
    } catch {
      return
    }

    expect(await startTimeOf({ pid: process.pid })).toMatch(/^\d+$/)
  })

  it('returns undefined for a pid that does not exist', async () => {
    expect(await startTimeOf({ pid: 4_000_000_000 })).toBeUndefined()
  })
})
