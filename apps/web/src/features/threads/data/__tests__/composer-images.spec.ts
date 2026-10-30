import { describe, expect, it } from 'bun:test'

import type { SaidImageWire } from '@dltech/atlas-wire/web'

import { imageNameOf, imagesFieldOf, sameImages, scaledSizeOf } from '../composer-images'
import { isRetryOf } from '../use-send'

const image = (data: string, path = 'a.png'): SaidImageWire => ({
  path,
  mediaType: 'image/png',
  data,
})

describe('imagesFieldOf', () => {
  it('omits an absent or empty list', () => {
    expect(imagesFieldOf(undefined)).toEqual({})
    expect(imagesFieldOf([])).toEqual({})
  })

  it('carries a non-empty list', () => {
    const images = [image('a')]
    expect(imagesFieldOf(images)).toEqual({ images })
  })
})

describe('scaledSizeOf', () => {
  it('leaves small images alone', () => {
    expect(scaledSizeOf({ width: 800, height: 600, maxEdge: 2000 })).toEqual({
      width: 800,
      height: 600,
    })
  })

  it('scales the long edge down to the cap keeping the aspect ratio', () => {
    expect(scaledSizeOf({ width: 4000, height: 1000, maxEdge: 2000 })).toEqual({
      width: 2000,
      height: 500,
    })
    expect(scaledSizeOf({ width: 1000, height: 3000, maxEdge: 2000 })).toEqual({
      width: 667,
      height: 2000,
    })
  })
})

describe('imageNameOf', () => {
  it('fixes the extension to the encoded type', () => {
    expect(imageNameOf({ fileName: 'shot.webp', index: 1, mediaType: 'image/png' })).toBe(
      'shot.png',
    )
    expect(imageNameOf({ fileName: 'shot.png', index: 1, mediaType: 'image/jpeg' })).toBe(
      'shot.jpg',
    )
  })

  it('numbers an unnamed paste', () => {
    expect(imageNameOf({ fileName: '', index: 3, mediaType: 'image/png' })).toBe(
      'pasted-image-3.png',
    )
  })
})

describe('sameImages / isRetryOf', () => {
  it('compares images by path and data', () => {
    expect(sameImages([image('a')], [image('a')])).toBe(true)
    expect(sameImages([image('a')], [image('b')])).toBe(false)
    expect(sameImages([image('a')], [])).toBe(false)
  })

  it('reuses a sendId only when text and images both match', () => {
    const previous = { text: 'hi', images: [image('a')] }
    expect(isRetryOf({ previous, text: 'hi', images: [image('a')] })).toBe(true)
    expect(isRetryOf({ previous, text: 'hi', images: [] })).toBe(false)
    expect(isRetryOf({ previous, text: 'yo', images: [image('a')] })).toBe(false)
    expect(isRetryOf({ previous: null, text: 'hi', images: [] })).toBe(false)
  })
})
