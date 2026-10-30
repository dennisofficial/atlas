import { describe, expect, it } from 'bun:test'
import { editExcerptOf } from './github-comment-edit-excerpt'

describe('editExcerptOf', () => {
  it('keeps only the lines added by the edit, in order', () => {
    expect(editExcerptOf({ before: 'a\nb\nc', after: 'a\nnew\nb\nc\nlast' })).toBe('new\nlast')
  })

  it('treats lines as a multiset so a repeated line counts once per occurrence', () => {
    expect(editExcerptOf({ before: 'x\ny', after: 'x\nx\ny' })).toBe('x')
  })

  it('trims trailing whitespace and drops blank lines', () => {
    expect(editExcerptOf({ before: 'a  ', after: 'a\n\n  \nb   ' })).toBe('b')
  })

  it('returns the whole body when there is no previous body', () => {
    expect(editExcerptOf({ before: undefined, after: 'a\nb' })).toBe('a\nb')
  })

  it('returns the whole body when the edit only removed lines', () => {
    expect(editExcerptOf({ before: 'a\nb', after: 'a' })).toBe('a')
  })
})
