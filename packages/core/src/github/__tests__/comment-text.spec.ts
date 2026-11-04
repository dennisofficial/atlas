import { describe, expect, it } from 'bun:test'

import { reviewCommentPlace, stripHtmlComments } from '../comment-text'

describe('stripHtmlComments', () => {
  it('removes a marker comment and keeps the text around it', () => {
    expect(stripHtmlComments('<!-- codex-pull-request-review-summary -->\nLooks good')).toBe(
      '\nLooks good',
    )
  })

  it('removes multi-line and repeated comments', () => {
    expect(stripHtmlComments('a<!--\nhidden\n-->b<!-- x -->c')).toBe('abc')
  })

  it('removes an unterminated comment through the end', () => {
    expect(stripHtmlComments('keep <!-- never closed')).toBe('keep ')
  })

  it('leaves text without comments alone', () => {
    expect(stripHtmlComments('plain <b>html</b>')).toBe('plain <b>html</b>')
  })
})

describe('reviewCommentPlace', () => {
  it('joins the path and line', () => {
    expect(reviewCommentPlace({ path: 'src/a.ts', line: 12 })).toBe('src/a.ts:12')
  })

  it('names only the path when the line is unknown', () => {
    expect(reviewCommentPlace({ path: 'src/a.ts', line: undefined })).toBe('src/a.ts')
  })

  it('is undefined without a path', () => {
    expect(reviewCommentPlace({ path: undefined, line: 3 })).toBeUndefined()
  })
})
