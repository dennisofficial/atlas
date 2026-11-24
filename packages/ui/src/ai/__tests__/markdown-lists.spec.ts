import { describe, expect, it } from 'bun:test'

import { nestUnderIndentedListItems } from '../internal/markdown-lists'

const lines = (...rows: string[]) => rows.join('\n')

describe('nestUnderIndentedListItems', () => {
  it('moves a two-space child of a numbered item under its label', () => {
    const text = lines('1. First', '  1. Second', '  2. Second again', '2. First again')

    expect(nestUnderIndentedListItems(text)).toBe(
      lines('1. First', '   1. Second', '   2. Second again', '2. First again'),
    )
  })

  it('carries the shift to deeper levels and continuation lines', () => {
    const text = lines('1. a', '  1. b', '    1. c', '       more of c', '  2. d')

    expect(nestUnderIndentedListItems(text)).toBe(
      lines('1. a', '   1. b', '      1. c', '         more of c', '   2. d'),
    )
  })

  it('aligns children of a two-digit number with its label', () => {
    const text = lines('10. a', '  - b', '11. c')

    expect(nestUnderIndentedListItems(text)).toBe(lines('10. a', '    - b', '11. c'))
  })

  it('leaves lists that already nest alone', () => {
    const text = lines('1. a', '   1. b', '2. c', '', '- x', '  - y', '    - z')

    expect(nestUnderIndentedListItems(text)).toBe(text)
  })

  it('keeps a one-space indent a sibling', () => {
    const text = lines('1. a', ' 2. b')

    expect(nestUnderIndentedListItems(text)).toBe(text)
  })

  it('stops after a paragraph that ends the list', () => {
    const text = lines('1. a', '  1. b', '', 'prose', '  - c')

    expect(nestUnderIndentedListItems(text)).toBe(lines('1. a', '   1. b', '', 'prose', '  - c'))
  })

  it('leaves fenced code alone', () => {
    const text = lines('```md', '1. a', '  1. b', '```')

    expect(nestUnderIndentedListItems(text)).toBe(text)
  })
})
