import { describe, expect, it } from 'bun:test'

import { keepLeadingSpaces } from '../internal/markdown-indent'

const lines = (...rows: string[]) => rows.join('\n')
const kept = (count: number) => '\u00a0'.repeat(count)

describe('keepLeadingSpaces', () => {
  it('keeps the indentation of pasted json lines', () => {
    const text = lines('see', '{', '  "a": {', '    "b": 1', '  }', '}')

    expect(keepLeadingSpaces(text)).toBe(
      lines('see', '{', `${kept(2)}"a": {`, `${kept(4)}"b": 1`, `${kept(2)}}`, '}'),
    )
  })

  it('counts a tab as four spaces', () => {
    expect(keepLeadingSpaces('a\n\tb')).toBe(`a\n${kept(4)}b`)
  })

  it('leaves list items and their nested lines alone', () => {
    const text = lines('1. a', '   1. b', '      more of b', '- c', '  - d')

    expect(keepLeadingSpaces(text)).toBe(text)
  })

  it('keeps indentation again once a blank line ends the list', () => {
    const text = lines('1. a', '', '{', '  "b": 1', '}')

    expect(keepLeadingSpaces(text)).toBe(lines('1. a', '', '{', `${kept(2)}"b": 1`, '}'))
  })

  it('leaves fenced code, tables, quotes, headings and rules alone', () => {
    const text = lines('```', '  code', '```', '  | a |', '  > quote', '  # title', '  ---')

    expect(keepLeadingSpaces(text)).toBe(text)
  })
})
