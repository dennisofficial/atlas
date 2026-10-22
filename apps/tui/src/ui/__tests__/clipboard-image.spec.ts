import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'

import { EImageTier, pngSize, projectedSize } from '@dltech/atlas-core'

import {
  appleScriptClipboardBytes,
  attachClipboardImage,
  newPasteMemory,
} from '../clipboard-image'
import { encodePng } from '../images/__tests__/png-fixture'

const platform = process.platform

const pretendPlatform = (name: string): void => {
  Object.defineProperty(process, 'platform', { value: name, configurable: true })
}

afterEach(() => pretendPlatform(platform))

describe('the AppleScript fallback, for a machine the native module skipped', () => {
  it('declines quietly where the coercion does not exist', async () => {
    pretendPlatform('linux')

    expect(await appleScriptClipboardBytes()).toBeNull()
  })

  it('declines quietly on win32 too, rather than shelling out', async () => {
    pretendPlatform('win32')

    expect(await appleScriptClipboardBytes()).toBeNull()
  })
})

const opened: string[] = []

const pasteDirectory = (): string => {
  const made = mkdtempSync(join(tmpdir(), 'atlas-paste-'))
  opened.push(made)
  return made
}

const picture = (shade: number): Buffer =>
  Buffer.from(
    encodePng({
      width: 2,
      height: 2,
      colourType: 2,
      bytesPerPixel: 3,
      samples: new Uint8Array(12).fill(shade),
    }),
  )

afterEach(() => {
  for (const made of opened.splice(0)) rmSync(made, { recursive: true, force: true })
})

describe('attaching the same clipboard picture twice', () => {
  it('writes one file when a single gesture opens both paste doors', async () => {
    const directory = pasteDirectory()
    const memory = newPasteMemory()
    const bytes = picture(7)
    const pull = async (): Promise<Buffer> => bytes

    const first = await attachClipboardImage({ directory, pull, memory })
    const second = await attachClipboardImage({ directory, pull, memory })

    expect(first?.path).toBeDefined()
    expect(second?.path).toBe(first?.path)
    expect(readdirSync(directory)).toHaveLength(1)
  })

  it('writes again once the picture on the clipboard has changed', async () => {
    const directory = pasteDirectory()
    const memory = newPasteMemory()

    const first = await attachClipboardImage({ directory, pull: async () => picture(7), memory })
    const second = await attachClipboardImage({ directory, pull: async () => picture(9), memory })

    expect(first?.path).toBeDefined()
    expect(second?.path).not.toBe(first?.path)
    expect(readdirSync(directory)).toHaveLength(2)
  })

  it('writes a fresh copy when the same picture lands in another thread', async () => {
    const memory = newPasteMemory()
    const bytes = picture(7)
    const pull = async (): Promise<Buffer> => bytes
    const one = pasteDirectory()
    const other = pasteDirectory()

    await attachClipboardImage({ directory: one, pull, memory })
    await attachClipboardImage({ directory: other, pull, memory })

    expect(readdirSync(one)).toHaveLength(1)
    expect(readdirSync(other)).toHaveLength(1)
  })

  it('reports nothing when the clipboard holds no picture', async () => {
    const memory = newPasteMemory()

    const nothing = await attachClipboardImage({
      directory: pasteDirectory(),
      pull: async () => null,
      memory,
    })

    expect(nothing).toBeNull()
  })
})

/** A photographic gradient — smooth enough to deflate well at full size, structured enough that downscaling still wins on the re-encode, so the larger-re-encode guard is not what passes the test. */
const screenshot = (args: { width: number; height: number; shade: number }): Buffer => {
  const stride = args.width * 3
  const samples = new Uint8Array(stride * args.height)
  for (let y = 0; y < args.height; y += 1) {
    for (let x = 0; x < args.width; x += 1) {
      const at = y * stride + x * 3
      samples[at] = (args.shade + Math.floor((x / args.width) * 128)) & 0xff
      samples[at + 1] = (args.shade + Math.floor((y / args.height) * 128)) & 0xff
      samples[at + 2] = (args.shade + ((x + y) % 64)) & 0xff
    }
  }
  return Buffer.from(
    encodePng({ width: args.width, height: args.height, colourType: 2, bytesPerPixel: 3, samples }),
  )
}

describe('resizing a paste to the model tier', () => {
  it('writes the projected size rather than the full-resolution bytes', async () => {
    const directory = pasteDirectory()
    const bytes = screenshot({ width: 4640, height: 2774, shade: 64 })

    const image = await attachClipboardImage({
      directory,
      tier: EImageTier.Standard,
      pull: async () => bytes,
      memory: newPasteMemory(),
    })

    const projected = projectedSize({ size: { width: 4640, height: 2774 } })
    expect(image?.width).toBe(projected.width)
    expect(image?.height).toBe(projected.height)
    expect(image?.byteLength).toBeLessThan(bytes.byteLength)

    const written = Buffer.from(readFileSync(image?.path ?? ''))
    expect(pngSize(written)).toEqual(projected)
  })

  it('leaves a picture that already fits untouched', async () => {
    const directory = pasteDirectory()
    const bytes = screenshot({ width: 640, height: 480, shade: 64 })

    const image = await attachClipboardImage({
      directory,
      tier: EImageTier.Standard,
      pull: async () => bytes,
      memory: newPasteMemory(),
    })

    expect(image?.width).toBe(640)
    expect(image?.height).toBe(480)
    expect(image?.byteLength).toBe(bytes.byteLength)
  })

  it('resizes to the high-resolution tier when the model reads it', async () => {
    const directory = pasteDirectory()
    const bytes = screenshot({ width: 4640, height: 2774, shade: 64 })

    const image = await attachClipboardImage({
      directory,
      tier: EImageTier.HighResolution,
      pull: async () => bytes,
      memory: newPasteMemory(),
    })

    const projected = projectedSize({ size: { width: 4640, height: 2774 }, tier: EImageTier.HighResolution })
    expect(image?.width).toBe(projected.width)
    expect(image?.height).toBe(projected.height)
    expect(projected.width).toBeGreaterThan(1568)
  })

  it('writes again when the same clipboard picture returns at a new tier', async () => {
    const directory = pasteDirectory()
    const bytes = screenshot({ width: 4640, height: 2774, shade: 64 })
    const pull = async (): Promise<Buffer> => bytes
    const memory = newPasteMemory()

    const standard = await attachClipboardImage({ directory, tier: EImageTier.Standard, pull, memory })
    const high = await attachClipboardImage({ directory, tier: EImageTier.HighResolution, pull, memory })

    expect(high?.path).not.toBe(standard?.path)
    expect(high?.width).toBeGreaterThan(standard?.width ?? 0)
    expect(readdirSync(directory)).toHaveLength(2)
  })
})
