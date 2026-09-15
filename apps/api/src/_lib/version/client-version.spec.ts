import { describe, expect, it } from 'vitest'
import { isBelowMinimum, parseClientVersion } from './client-version'

describe('parseClientVersion', () => {
  it('parses a numeric semver', () => {
    expect(parseClientVersion('1.4.0')).toEqual([1, 4, 0])
    expect(parseClientVersion('0.0.0')).toEqual([0, 0, 0])
    expect(parseClientVersion('12.345.6789')).toEqual([12, 345, 6789])
  })

  it('rejects a missing patch', () => {
    expect(parseClientVersion('1.4')).toBeNull()
  })

  it('rejects a leading v', () => {
    expect(parseClientVersion('v1.4.0')).toBeNull()
  })

  it('rejects dev build stamps', () => {
    expect(parseClientVersion('dev')).toBeNull()
    expect(parseClientVersion('dev+20260914-abc123')).toBeNull()
  })

  it('rejects empty and garbage strings', () => {
    expect(parseClientVersion('')).toBeNull()
    expect(parseClientVersion('not a version')).toBeNull()
    expect(parseClientVersion('1.4.x')).toBeNull()
    expect(parseClientVersion('1.4.0.1')).toBeNull()
    expect(parseClientVersion('1.4.0-rc.1')).toBeNull()
  })
})

describe('isBelowMinimum', () => {
  const minimum = [2, 4, 6] as const

  it('flags a lower major', () => {
    expect(isBelowMinimum({ minimum, received: [1, 9, 9] })).toBe(true)
  })

  it('flags a lower minor', () => {
    expect(isBelowMinimum({ minimum, received: [2, 3, 9] })).toBe(true)
  })

  it('flags a lower patch', () => {
    expect(isBelowMinimum({ minimum, received: [2, 4, 5] })).toBe(true)
  })

  it('accepts an equal version', () => {
    expect(isBelowMinimum({ minimum, received: [2, 4, 6] })).toBe(false)
  })

  it('accepts a newer version', () => {
    expect(isBelowMinimum({ minimum, received: [3, 0, 0] })).toBe(false)
  })

  it('gives major precedence over minor and patch', () => {
    expect(isBelowMinimum({ minimum, received: [1, 9, 9] })).toBe(true)
    expect(isBelowMinimum({ minimum, received: [3, 0, 0] })).toBe(false)
  })

  it('gives minor precedence over patch', () => {
    expect(isBelowMinimum({ minimum, received: [2, 3, 9] })).toBe(true)
    expect(isBelowMinimum({ minimum, received: [2, 5, 0] })).toBe(false)
  })
})
