import { describe, expect, it } from 'bun:test'

import { INLINE_CODE_LEADING_PAD, INLINE_CODE_TRAILING_PAD } from '../markdown/inline-code-text'

const WORD_JOINER = '\u2060'

describe('inline code padding', () => {
  it('pads with a thin space, since iOS ignores padding on a nested span', () => {
    expect(INLINE_CODE_LEADING_PAD.startsWith('\u2009')).toBe(true)
    expect(INLINE_CODE_TRAILING_PAD.endsWith('\u2009')).toBe(true)
  })

  it('joins each pad to the code, so a line never breaks between them', () => {
    expect(INLINE_CODE_LEADING_PAD.endsWith(WORD_JOINER)).toBe(true)
    expect(INLINE_CODE_TRAILING_PAD.startsWith(WORD_JOINER)).toBe(true)
  })
})
