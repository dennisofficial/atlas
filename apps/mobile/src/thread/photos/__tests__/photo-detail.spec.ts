import { describe, expect, it } from 'bun:test'

import { photoDetailOf } from '../photo-detail'

const uri = 'https://x/a.png'

describe('photoDetailOf', () => {
  it('names the format, the size in pixels and the bytes', () => {
    expect(
      photoDetailOf({
        uri,
        name: 'a.png',
        mediaType: 'image/png',
        width: 1600,
        height: 800,
        size: 521_189,
      }),
    ).toBe('PNG, 1600 × 800, 509 KB')
  })

  it('separates metadata with punctuation, not middle dots', () => {
    expect(
      photoDetailOf({
        uri,
        name: 'a.png',
        mediaType: 'image/png',
        width: 1600,
        height: 800,
        size: 521_189,
      }),
    ).not.toContain('\u00b7')
  })

  it('leaves out what it does not know', () => {
    expect(photoDetailOf({ uri, name: 'a.jpg', mediaType: 'image/jpeg', size: 2_048 })).toBe(
      'JPEG, 2.0 KB',
    )
    expect(photoDetailOf({ uri, name: 'a.svg', mediaType: 'image/svg+xml' })).toBe('SVG')
  })

  it('has no detail when nothing is known', () => {
    expect(photoDetailOf({ uri, name: 'a' })).toBeUndefined()
    expect(photoDetailOf({ uri, name: 'a', width: 0, height: 10, size: 0 })).toBeUndefined()
  })
})
