import { describe, expect, it } from 'bun:test'

import { mergeWithdrawnIntoDraft } from '../queued-messages'

describe('mergeWithdrawnIntoDraft', () => {
  it('uses the withdrawn text alone when the draft is blank', () => {
    expect(mergeWithdrawnIntoDraft({ withdrawn: 'hello', draft: '' })).toBe('hello')
    expect(mergeWithdrawnIntoDraft({ withdrawn: 'hello', draft: '  \n' })).toBe('hello')
  })

  it('puts the withdrawn text first, a blank line, then the existing draft', () => {
    expect(mergeWithdrawnIntoDraft({ withdrawn: 'hello', draft: 'typing' })).toBe('hello\n\ntyping')
  })
})
