import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { canonicalJson } from '../canonical'

const anyCodeUnits = fc
  .array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 12 })
  .map((units) => String.fromCharCode(...units))

const jsonValue = fc.letrec<{ value: unknown }>((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.constant(null),
    fc.boolean(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    anyCodeUnits,
    fc.array(tie('value'), { maxLength: 4 }),
    fc.dictionary(anyCodeUnits, tie('value'), { maxKeys: 4 }),
  ),
})).value

describe('canonicalJson', () => {
  it('sorts keys, drops undefined members and writes no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, undefined, 'x'], c: undefined } })).toBe(
      '{"a":{"d":[1,null,"x"]},"b":1}',
    )
  })

  it('writes NUL as the six characters \\u0000', () => {
    expect(canonicalJson({ text: 'a\u0000b' })).toBe('{"text":"a\\u0000b"}')
  })

  it('escapes lone surrogates so the output is well-formed text', () => {
    expect(canonicalJson('\ud800')).toBe('"\\ud800"')
    expect(canonicalJson('\udc00x')).toBe('"\\udc00x"')
  })

  it('throws on values JSON cannot carry faithfully', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow()
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow()
    expect(() => canonicalJson(10n)).toThrow()
    expect(() => canonicalJson(() => 1)).toThrow()
    expect(() => canonicalJson(new Map())).toThrow()
    expect(() => canonicalJson(undefined)).toThrow()
  })

  it('is stable through JSON.parse for any value including NUL and lone surrogates', () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        const once = canonicalJson(value)
        expect(canonicalJson(JSON.parse(once))).toBe(once)
      }),
    )
  })

  it('never emits a raw NUL or lone surrogate', () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        const text = canonicalJson(value)
        expect(text.includes('\u0000')).toBe(false)
        expect(/\p{Cs}/u.test(text)).toBe(false)
      }),
    )
  })

  it('does not depend on key insertion order', () => {
    fc.assert(
      fc.property(fc.dictionary(anyCodeUnits, fc.integer(), { minKeys: 1, maxKeys: 6 }), (dict) => {
        const reversed = Object.fromEntries(Object.entries(dict).reverse())
        expect(canonicalJson(reversed)).toBe(canonicalJson(dict))
      }),
    )
  })
})
