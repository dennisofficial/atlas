import { describe, expect, test } from 'bun:test'

import { enumValueOf } from '../enum-value'
import { MAX_QUEUED, queueOf } from '../queue-fixtures'
import { ESessionState } from '../session-types'
import { isKnownThreadId } from '../thread-ids'

describe('queueOf', () => {
  test('returns exactly the requested count, clamped to 0..5', () => {
    expect(queueOf(0)).toHaveLength(0)
    expect(queueOf(3)).toHaveLength(3)
    expect(queueOf(99)).toHaveLength(MAX_QUEUED)
    expect(queueOf(-2)).toHaveLength(0)
  })
})

describe('isKnownThreadId', () => {
  test('accepts threads and teammates, rejects the rest', () => {
    expect(isKnownThreadId('thr-ui-rebase')).toBe(true)
    expect(isKnownThreadId('tm-gutter-tokens')).toBe(true)
    expect(isKnownThreadId('nope')).toBe(false)
  })
})

describe('enumValueOf', () => {
  test('narrows a string to the enum or falls back', () => {
    const options = Object.values(ESessionState)
    const fallback = ESessionState.Running
    expect(enumValueOf({ options, value: 'idle', fallback })).toBe(ESessionState.Idle)
    expect(enumValueOf({ options, value: 'x', fallback })).toBe(fallback)
  })
})
