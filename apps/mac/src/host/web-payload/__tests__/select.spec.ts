import { describe, expect, test } from 'bun:test'

import { selectedPayload, stalePayloads } from '../select'

const first = '1'.repeat(16)
const second = '2'.repeat(16)
const third = '3'.repeat(16)

describe('selectedPayload', () => {
  test('prefers the current payload', () => {
    expect(
      selectedPayload({ state: { current: second, previous: first }, isComplete: () => true }),
    ).toBe(second)
  })

  test('falls back to the previous payload when the current one is gone', () => {
    expect(
      selectedPayload({
        state: { current: second, previous: first },
        isComplete: (hash) => hash === first,
      }),
    ).toBe(first)
  })

  test('never selects a payload that failed to start', () => {
    expect(
      selectedPayload({
        state: { current: second, previous: first, failed: second },
        isComplete: () => true,
      }),
    ).toBe(first)
  })

  test('returns nothing when no payload is complete', () => {
    expect(selectedPayload({ state: { current: second }, isComplete: () => false })).toBeUndefined()
  })
})

describe('stalePayloads', () => {
  test('keeps the current and previous payloads and drops the rest', () => {
    expect(
      stalePayloads({
        dirs: [first, second, third, '.staging-4444444444444444'],
        state: { current: second, previous: first },
      }),
    ).toEqual([third, '.staging-4444444444444444'])
  })
})
