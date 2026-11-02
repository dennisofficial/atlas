import { describe, expect, it } from 'bun:test'

import type { DiffLine } from '@dltech/atlas-ui/ai/diff-viewer'

import { lineMarksOf } from '../line-marks'

const add = (newNumber: number): DiffLine => ({ kind: 'add', text: 'x', newNumber })
const remove = (oldNumber: number): DiffLine => ({ kind: 'remove', text: 'x', oldNumber })
const context = (n: number): DiffLine => ({
  kind: 'context',
  text: 'x',
  oldNumber: n,
  newNumber: n,
})
const gap: DiffLine = { kind: 'gap', text: '3 unchanged lines' }

describe('lineMarksOf', () => {
  it('marks adds with no removes as added', () => {
    expect([...lineMarksOf([context(1), add(2), add(3), context(4)])]).toEqual([
      [2, 'added'],
      [3, 'added'],
    ])
  })

  it('marks adds that replace removes as modified, extras as added', () => {
    const marks = lineMarksOf([remove(2), add(2), add(3)])
    expect(marks.get(2)).toBe('modified')
    expect(marks.get(3)).toBe('added')
  })

  it('puts a deleted marker on the next surviving line', () => {
    expect([...lineMarksOf([context(1), remove(2), remove(3), context(2)])]).toEqual([
      [2, 'deleted-above'],
    ])
  })

  it('puts a trailing deletion past the last line, and a gap ends a hunk', () => {
    expect(lineMarksOf([context(1), remove(2)]).get(2)).toBe('deleted-above')
    expect(lineMarksOf([context(1), remove(2), gap, add(9)]).get(9)).toBe('added')
  })
})
