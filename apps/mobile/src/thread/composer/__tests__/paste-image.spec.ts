import { describe, expect, it } from 'bun:test'

import { pastedFileOf } from '../paste-image'

describe('pastedFileOf', () => {
  it('reads the media type from the extension of the pasted file', () => {
    expect(pastedFileOf({ uri: 'file:///tmp/A1B2.png', at: 7, index: 0 })).toEqual({
      name: 'pasted-7.png',
      size: 0,
      mediaType: 'image/png',
      uri: 'file:///tmp/A1B2.png',
    })
  })

  it('names a pasted jpeg with the jpg extension', () => {
    const file = pastedFileOf({ uri: 'file:///tmp/A1B2.jpeg', at: 1, index: 0 })
    expect(file.name).toBe('pasted-1.jpg')
    expect(file.mediaType).toBe('image/jpeg')
  })

  it('keeps a pasted gif a gif', () => {
    expect(pastedFileOf({ uri: 'file:///tmp/A.GIF', at: 1, index: 0 }).mediaType).toBe('image/gif')
  })

  it('numbers the second and later images of one paste', () => {
    expect(pastedFileOf({ uri: 'file:///tmp/B.png', at: 3, index: 1 }).name).toBe('pasted-3-2.png')
  })

  it('treats a file without a known extension as png', () => {
    const file = pastedFileOf({ uri: 'file:///tmp/blob', at: 2, index: 0 })
    expect(file.name).toBe('pasted-2.png')
    expect(file.mediaType).toBe('image/png')
  })
})
