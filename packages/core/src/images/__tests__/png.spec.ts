import { deflateSync, inflateSync } from 'node:zlib'

import { describe, expect, it } from 'bun:test'

import { pngSize } from '../limits'
import { decodePng, downscalePng, downscaleRgba, encodePng, type PngCodec, type RgbaImage } from '../png'
import { patchTokens, projectedSize } from '../projection'

const codec: PngCodec = {
  inflate: (bytes) => new Uint8Array(inflateSync(bytes)),
  deflate: (bytes) => new Uint8Array(deflateSync(bytes)),
}

/** A solid-shade raster, encoded and decoded through the real PNG path. */
const solidPng = (args: { width: number; height: number; shade: number }): Uint8Array => {
  const rgba = new Uint8Array(args.width * args.height * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = args.shade
    rgba[i + 1] = args.shade
    rgba[i + 2] = args.shade
    rgba[i + 3] = 255
  }
  return encodePng({ size: { width: args.width, height: args.height }, rgba }, codec)
}

/** Left half one shade, right half another — the patterns filters and resampling have to honour. */
const splitPng = (args: { width: number; height: number; left: number; right: number }): Uint8Array => {
  const rgba = new Uint8Array(args.width * args.height * 4)
  for (let y = 0; y < args.height; y += 1) {
    for (let x = 0; x < args.width; x += 1) {
      const shade = x < args.width / 2 ? args.left : args.right
      const at = (y * args.width + x) * 4
      rgba[at] = shade
      rgba[at + 1] = shade
      rgba[at + 2] = shade
      rgba[at + 3] = 255
    }
  }
  return encodePng({ size: { width: args.width, height: args.height }, rgba }, codec)
}

describe('decodePng', () => {
  it('round-trips an encoded raster exactly', () => {
    const bytes = splitPng({ width: 8, height: 4, left: 30, right: 200 })
    const decoded = decodePng(bytes, codec)

    expect(decoded).not.toBeNull()
    expect(decoded?.size).toEqual({ width: 8, height: 4 })
    expect(decoded?.rgba[0]).toBe(30)
    expect(decoded?.rgba[(3 * 8 + 7) * 4]).toBe(200)
    expect(decoded?.rgba[3]).toBe(255)
  })

  it('refuses bytes that are not a PNG', () => {
    expect(decodePng(new Uint8Array([1, 2, 3, 4]), codec)).toBeNull()
    expect(decodePng(new Uint8Array(0), codec)).toBeNull()
  })

  it('refuses a PNG whose IDAT will not inflate', () => {
    const bytes = solidPng({ width: 2, height: 2, shade: 9 })
    const mangled = new Uint8Array(bytes)
    for (let i = bytes.length - 20; i < bytes.length - 10; i += 1) mangled[i] = 0xff

    expect(decodePng(mangled, codec)).toBeNull()
  })
})

describe('downscaleRgba', () => {
  const gradient = (width: number, height: number): RgbaImage => {
    const rgba = new Uint8Array(width * height * 4)
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        const at = (y * width + x) * 4
        rgba[at] = Math.round((x / (width - 1)) * 255)
        rgba[at + 1] = 0
        rgba[at + 2] = 0
        rgba[at + 3] = 255
      }
    }
    return { size: { width, height }, rgba }
  }

  it('averages source pixels into each output pixel', () => {
    const scaled = downscaleRgba(gradient(4, 1), { width: 2, height: 1 })

    expect(scaled.size).toEqual({ width: 2, height: 1 })
    expect(scaled.rgba[0]).toBe(Math.round(((0 + 85) / 255) * 255 * 0 + (0 + 85) / 2))
    expect(scaled.rgba[0]).toBe(43)
    expect(scaled.rgba[4]).toBe(213)
  })

  it('never upscales', () => {
    const image = gradient(2, 2)
    const scaled = downscaleRgba(image, { width: 8, height: 8 })

    expect(scaled.size).toEqual({ width: 2, height: 2 })
  })

  it('holds a flat field flat', () => {
    const rgba = new Uint8Array(16 * 16 * 4).fill(120)
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
    const scaled = downscaleRgba({ size: { width: 16, height: 16 }, rgba }, { width: 4, height: 4 })

    for (let i = 0; i < scaled.rgba.length; i += 4) {
      expect(scaled.rgba[i]).toBe(120)
    }
  })
})

describe('downscalePng', () => {
  it('shrinks a large screenshot to the standard-tier projection, aspect preserved', () => {
    const size = { width: 4640, height: 2774 }
    const bytes = solidPng({ ...size, shade: 64 })
    const target = projectedSize({ size })

    const scaled = downscalePng({ bytes, target, codec })

    expect(scaled).not.toBeNull()
    expect(pngSize(scaled ?? new Uint8Array(0))).toEqual(target)
    expect(patchTokens(target)).toBeLessThanOrEqual(1568)
    expect(scaled?.byteLength).toBeLessThan(bytes.byteLength)
  })

  it('returns null for an upscale, so the original bytes stand', () => {
    const bytes = solidPng({ width: 4, height: 4, shade: 200 })

    expect(downscalePng({ bytes, target: { width: 8, height: 8 }, codec })).toBeNull()
  })

  it('returns null for undecodable bytes rather than throwing', () => {
    expect(downscalePng({ bytes: new Uint8Array([0x89, 0x50]), target: { width: 1, height: 1 }, codec })).toBeNull()
  })

  it('returns null when the re-encode would come out larger', () => {
    const bytes = solidPng({ width: 32, height: 32, shade: 1 })

    expect(downscalePng({ bytes, target: { width: 31, height: 31 }, codec })).toBeNull()
  })

  it('keeps a hard edge legible through a real halving', () => {
    const bytes = splitPng({ width: 100, height: 50, left: 0, right: 255 })
    const scaled = downscalePng({ bytes, target: { width: 50, height: 25 }, codec })
    expect(scaled).not.toBeNull()

    const decoded = decodePng(scaled ?? new Uint8Array(0), codec)
    expect(decoded?.size).toEqual({ width: 50, height: 25 })
    expect(decoded?.rgba[0]).toBe(0)
    expect(decoded?.rgba[49 * 4]).toBe(255)
  })
})
