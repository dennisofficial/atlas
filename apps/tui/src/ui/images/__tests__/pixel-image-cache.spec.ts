import { describe, expect, test } from 'bun:test'
import { NativeImage } from '@opentui/core'

import { PixelImageCache } from '../pixel-image-cache'

const source = (): NativeImage => NativeImage.fromRgba(new Uint8Array(128 * 256 * 4).fill(255), 128, 256)

const placement = (pixels: { width: number; height: number }) => ({
  source: { x: 0, y: 128, width: 128, height: 128 },
  destination: { x: 0, y: 0, width: 8, height: 4 },
  pixels,
})

describe('a prepared pixel image', () => {
  test('shrinks at the native area threshold to display pixels rather than character cells', () => {
    const image = source()
    const cache = new PixelImageCache()
    try {
      const prepared = cache.imageFor({ image, placement: placement({ width: 64, height: 64 }) })
      expect([prepared.width, prepared.height]).toEqual([64, 64])
      expect([image.width, image.height]).toEqual([128, 256])
      expect(prepared.raw().data.length).toBe(64 * 64 * 4)
    } finally {
      cache.clear()
      image.dispose()
    }
  })

  test('preserves original source detail below the downscale threshold', () => {
    const image = source()
    const cache = new PixelImageCache()
    try {
      const prepared = cache.imageFor({ image, placement: placement({ width: 80, height: 80 }) })
      expect([prepared.width, prepared.height]).toEqual([128, 128])
    } finally {
      cache.clear()
      image.dispose()
    }
  })

  test('does not upsample a source smaller than the display area', () => {
    const image = source()
    const cache = new PixelImageCache()
    try {
      const prepared = cache.imageFor({ image, placement: placement({ width: 256, height: 256 }) })
      expect([prepared.width, prepared.height]).toEqual([128, 128])
    } finally {
      cache.clear()
      image.dispose()
    }
  })

  test('invalidates the prepared image when pixel resolution changes', () => {
    const image = source()
    const cache = new PixelImageCache()
    try {
      const before = cache.imageFor({ image, placement: placement({ width: 64, height: 64 }) })
      const after = cache.imageFor({ image, placement: placement({ width: 80, height: 80 }) })
      expect([after.width, after.height]).toEqual([128, 128])
      expect(() => before.ptr).toThrow()
      expect(cache.imageFor({ image, placement: placement({ width: 80, height: 80 }) })).toBe(after)
    } finally {
      cache.clear()
      image.dispose()
    }
  })
})
