import { describe, expect, it } from 'bun:test'

import { diffLines, linesOf, unchangedLabel } from '../line-diff'

describe('linesOf', () => {
  it('keeps a trailing newline as an empty last line', () => {
    expect(linesOf('a\nb\n')).toEqual(['a', 'b', ''])
    expect(linesOf('a\nb')).toEqual(['a', 'b'])
    expect(linesOf('')).toEqual([])
  })
})

describe('diffLines', () => {
  it('marks a changed line and hides the untouched runs', () => {
    expect(diffLines({ before: 'a\nb\nc\n', after: 'a\nx\nc\n' })).toEqual([
      { kind: 'gap', text: '1 unchanged line' },
      { kind: 'remove', text: 'b', oldNumber: 2 },
      { kind: 'add', text: 'x', newNumber: 2 },
      { kind: 'gap', text: '2 unchanged lines' },
    ])
  })

  it('reports insertions and deletions in one pass', () => {
    expect(diffLines({ before: 'a\nb\n', after: 'a\nx\ny\n' })).toEqual([
      { kind: 'gap', text: '1 unchanged line' },
      { kind: 'remove', text: 'b', oldNumber: 2 },
      { kind: 'add', text: 'x', newNumber: 2 },
      { kind: 'add', text: 'y', newNumber: 3 },
      { kind: 'gap', text: '1 unchanged line' },
    ])
  })

  it('shows every line of an added file', () => {
    expect(diffLines({ before: '', after: 'one\ntwo\n' })).toEqual([
      { kind: 'add', text: 'one', newNumber: 1 },
      { kind: 'add', text: 'two', newNumber: 2 },
      { kind: 'add', text: '', newNumber: 3 },
    ])
  })

  it('shows every line of a removed file', () => {
    expect(diffLines({ before: 'one\n', after: '' })).toEqual([
      { kind: 'remove', text: 'one', oldNumber: 1 },
      { kind: 'remove', text: '', oldNumber: 2 },
    ])
  })

  it('treats a missing trailing newline as a change', () => {
    expect(diffLines({ before: 'a', after: 'a\n' })).toEqual([
      { kind: 'gap', text: '1 unchanged line' },
      { kind: 'add', text: '', newNumber: 2 },
    ])
  })

  it('diffs nothing when both sides are empty', () => {
    expect(diffLines({ before: '', after: '' })).toEqual([])
  })

  it('labels a single unchanged line in the singular', () => {
    expect(unchangedLabel(1)).toBe('1 unchanged line')
    expect(unchangedLabel(7)).toBe('7 unchanged lines')
  })

  it('diffs a 5 000 line pair in under 100 ms', () => {
    const before = Array.from({ length: 5_000 }, (_, index) => `line ${index}`)
    const after = before.map((line, index) => (index % 7 === 0 ? `${line} changed` : line))
    const started = performance.now()
    const lines = diffLines({ before: before.join('\n'), after: after.join('\n') })
    expect(performance.now() - started).toBeLessThan(100)
    expect(lines.length).toBeGreaterThan(0)
  })
})
