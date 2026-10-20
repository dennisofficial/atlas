import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, executionLocationOf } from '../location'

describe('an execution location named as text', () => {
  it('reads the value the column holds', () => {
    expect(executionLocationOf('cloud')).toBe(EExecutionLocation.Cloud)
  })

  it('reads nothing into no decision, so an unwritten column stays undecided', () => {
    expect(executionLocationOf(null)).toBeUndefined()
    expect(executionLocationOf(undefined)).toBeUndefined()
    expect(executionLocationOf('')).toBeUndefined()
  })

  it('reads a value this build never writes as undecided rather than guessing at one', () => {
    expect(executionLocationOf('podman')).toBeUndefined()
    expect(executionLocationOf('CLOUD')).toBeUndefined()
  })
})
