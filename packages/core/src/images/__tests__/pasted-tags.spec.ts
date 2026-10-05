import { describe, expect, it } from 'bun:test'

import { pastedTagSpans } from '../pasted-tags'

describe('pastedTagSpans', () => {
  it('finds every collapsed-paste label with its span, ordinal and line count', () => {
    const text = 'alpha [Pasted text #1 +3 lines] mid [Pasted text #2 +12 lines] omega'

    expect(pastedTagSpans(text)).toEqual([
      { start: 6, end: 6 + '[Pasted text #1 +3 lines]'.length, ordinal: 1, lines: 3 },
      {
        start: 6 + '[Pasted text #1 +3 lines]'.length + ' mid '.length,
        end: 6 + '[Pasted text #1 +3 lines]'.length + ' mid '.length + '[Pasted text #2 +12 lines]'.length,
        ordinal: 2,
        lines: 12,
      },
    ])
  })

  it('reads nothing out of prose that only mentions one', () => {
    expect(pastedTagSpans('no label here')).toEqual([])
    expect(pastedTagSpans('[Pasted text #1]')).toEqual([])
    expect(pastedTagSpans('[Pasted text #1 +3 line]')).toEqual([])
  })

  it('distinguishes a pasted label from an image tag at the same offsets', () => {
    const text = '[Image #1] and [Pasted text #1 +5 lines]'

    expect(pastedTagSpans(text)).toEqual([
      { start: 15, end: 15 + '[Pasted text #1 +5 lines]'.length, ordinal: 1, lines: 5 },
    ])
  })
})
