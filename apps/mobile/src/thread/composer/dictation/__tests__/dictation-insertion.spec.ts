import { describe, expect, it } from 'bun:test'

import { insertionOf } from '../dictation-insertion'

describe('insertionOf', () => {
  it('puts the speech where the cursor was', () => {
    const inserted = insertionOf({ before: 'Send it to ', spoken: 'Dennis', after: ' now' })

    expect(inserted.text).toBe('Send it to Dennis now')
    expect(inserted.cursor).toBe('Send it to Dennis'.length)
  })

  it('adds the gap the sentence needs around the speech', () => {
    expect(insertionOf({ before: 'Send to', spoken: 'Dennis', after: '.' }).text).toBe(
      'Send to Dennis.',
    )
    expect(insertionOf({ before: '', spoken: 'Dennis', after: 'now' }).text).toBe('Dennis now')
  })

  it('leaves the draft alone when nothing was said', () => {
    const inserted = insertionOf({ before: 'Ask ', spoken: '', after: 'Atlas' })

    expect(inserted.text).toBe('Ask Atlas')
    expect(inserted.cursor).toBe('Ask '.length)
  })
})
