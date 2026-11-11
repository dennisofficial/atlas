import { describe, expect, it } from 'bun:test'

import { randomToken } from '../index'

const TOKEN_PATTERN = /^[a-z0-9]{8}$/

describe('randomToken', () => {
  it('renders six zero bytes as eight zeros', () => {
    expect(randomToken(new Uint8Array(6))).toBe('00000000')
  })

  it('renders full bytes without leaving the alphabet', () => {
    const token = randomToken(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))
    expect(token).toMatch(TOKEN_PATTERN)
  })

  it('is deterministic for the same randomness', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6])
    expect(randomToken(bytes)).toBe(randomToken(new Uint8Array([1, 2, 3, 4, 5, 6])))
  })

  it('keeps eight characters for a long value', () => {
    expect(randomToken(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))).toHaveLength(8)
  })

  it('pads a short value to eight characters', () => {
    expect(randomToken(new Uint8Array([0, 0, 0, 0, 0, 1]))).toBe('00000001')
  })

  it.each([0, 1, 2, 5, 17, 42, 200, 255])(
    'yields eight lowercase alphanumerics for byte %p',
    (byte) => {
      expect(randomToken(new Uint8Array([byte, byte, byte, byte, byte, byte]))).toMatch(
        TOKEN_PATTERN,
      )
    },
  )

  it('differs across neighbouring randomness', () => {
    const first = randomToken(new Uint8Array([1, 2, 3, 4, 5, 6]))
    const second = randomToken(new Uint8Array([1, 2, 3, 4, 5, 7]))
    expect(first).not.toBe(second)
  })
})
