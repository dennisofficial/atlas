import { describe, expect, it } from 'bun:test'

import { pastedTag } from '@dltech/atlas-core'

import { snappedRange, tokenizablePaste, substitutePastedTokens, type LiveToken } from '../composer-tokens'

describe('a pasted block of text', () => {
  it('is tokenised once it is longer than a few lines', () => {
    expect(tokenizablePaste('one\ntwo\nthree\nfour')).toBe(false)
    expect(tokenizablePaste('one\ntwo\nthree\nfour\nfive')).toBe(true)
    expect(tokenizablePaste('one short line')).toBe(false)
  })

  it('labels its rank and its line count', () => {
    expect(pastedTag(1, 3)).toBe('[Pasted text #1 +3 lines]')
  })

  it('substitutes its content back into the message right to left', () => {
    const text = 'alpha [Pasted text #1 +3 lines] mid [Pasted text #2 +2 lines] omega'
    const one = text.indexOf('#1')
    const two = text.indexOf('#2')
    expect(one).not.toBe(-1)

    const tokens = [
      {
        id: 1,
        start: text.indexOf('[Pasted text #1'),
        end: text.indexOf('[Pasted text #1') + '[Pasted text #1 +3 lines]'.length,
        ordinal: 0,
        slot: {
          kind: 'pasted' as const,
          label: '[Pasted text #1 +3 lines]',
          content: 'one\ntwo\nthree',
        },
      },
      {
        id: 2,
        start: text.indexOf('[Pasted text #2'),
        end: text.indexOf('[Pasted text #2') + '[Pasted text #2 +2 lines]'.length,
        ordinal: 0,
        slot: {
          kind: 'pasted' as const,
          label: '[Pasted text #2 +2 lines]',
          content: 'x\ny',
        },
      },
    ]

    expect(substitutePastedTokens({ text, tokens })).toBe('alpha one\ntwo\nthree mid x\ny omega')
    expect(two).not.toBe(one)
  })
})

describe('snappedRange', () => {
  const token = (start: number, end: number): LiveToken => ({
    id: start,
    start,
    end,
    ordinal: 0,
    slot: { kind: 'pasted', label: '[Pasted text #1 +3 lines]', content: 'one\ntwo\nthree' },
  })

  it('expands a range that starts inside a token to the token start', () => {
    expect(snappedRange({ tokens: [token(10, 20)], start: 15, end: 30 })).toEqual({
      start: 10,
      end: 30,
    })
  })

  it('expands a range that ends inside a token to the token end', () => {
    expect(snappedRange({ tokens: [token(10, 20)], start: 0, end: 15 })).toEqual({
      start: 0,
      end: 20,
    })
  })

  it('takes a range covering a token whole exactly as given', () => {
    expect(snappedRange({ tokens: [token(10, 20)], start: 5, end: 25 })).toEqual({
      start: 5,
      end: 25,
    })
  })

  it('leaves a range that only touches token boundaries alone', () => {
    expect(snappedRange({ tokens: [token(10, 20)], start: 20, end: 30 })).toEqual({
      start: 20,
      end: 30,
    })
    expect(snappedRange({ tokens: [token(10, 20)], start: 0, end: 10 })).toEqual({
      start: 0,
      end: 10,
    })
  })

  it('leaves a range with no token in it alone', () => {
    expect(snappedRange({ tokens: [token(10, 20)], start: 30, end: 40 })).toEqual({
      start: 30,
      end: 40,
    })
    expect(snappedRange({ tokens: [], start: 0, end: 5 })).toEqual({ start: 0, end: 5 })
  })
})
