import { describe, expect, it } from 'bun:test'

import { MAX_INLINE_BYTES } from '../../images/limits'
import { mediaRefSchema, type MediaRef } from '../media-ref'

export const ref: MediaRef = {
  hash: 'a'.repeat(64),
  mediaType: 'image/png',
  size: 1234,
  width: 640,
  height: 480,
}

describe('mediaRefSchema', () => {
  it('accepts a well-formed reference', () => {
    expect(mediaRefSchema.parse(ref)).toEqual(ref)
  })

  it.each([
    ['a short hash', { hash: 'a'.repeat(63) }],
    ['an uppercase hash', { hash: 'A'.repeat(64) }],
    ['an unsupported media type', { mediaType: 'image/bmp' }],
    ['a zero size', { size: 0 }],
    ['a size past the inline ceiling', { size: MAX_INLINE_BYTES + 1 }],
    ['a fractional width', { width: 1.5 }],
    ['a zero height', { height: 0 }],
  ])('rejects %s', (_, override) => {
    expect(mediaRefSchema.safeParse({ ...ref, ...override }).success).toBe(false)
  })

  it('rejects unknown keys, so a signed URL can never ride along', () => {
    expect(mediaRefSchema.safeParse({ ...ref, url: 'https://x' }).success).toBe(false)
  })
})
