import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

import {
  downscalePng,
  EImageDelivery,
  imageMediaType,
  imageSize,
  planDelivery,
  projectedSize,
  visualTokens,
  type EImageTier,
  type PngCodec,
  type SupportedImageMediaType,
} from '@dltech/atlas-core'

/** Core is pure and imports no node builtins, so the zlib the PNG codec needs is supplied here. */
const pngCodec: PngCodec = {
  inflate: (bytes) => new Uint8Array(inflateSync(bytes)),
  deflate: (bytes) => new Uint8Array(deflateSync(bytes)),
}

export type ClipboardImage = {
  path: string
  mediaType: string
  byteLength: number
  width?: number | undefined
  height?: number | undefined
  delivery: EImageDelivery
  tokens: number | null
  reason?: string | undefined
  tier?: EImageTier | undefined
}

export type ClipboardImageReader = (args: {
  directory: string
  tier?: EImageTier | undefined
}) => Promise<ClipboardImage | null>

/** AppleScript renders raw clipboard data as `«data PNGf8950…»` — hex, not base64. */
const PNG_HEX = /«data PNGf([0-9A-Fa-f]+)»/

const EXTENSIONS: Record<SupportedImageMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

let pasted = 0

const pasteName = (extension: string): string => {
  pasted += 1
  return `paste-${Date.now()}-${pasted}.${extension}`
}

type NativeClipboard = { hasImage: () => boolean; getImageBase64: () => Promise<string> }

let native: NativeClipboard | null | undefined

/**
 * Reads the system pasteboard in-process. A required dependency — a build that cannot resolve it
 * should fail loudly rather than ship a binary that quietly takes the slow door. The guard is for
 * the narrower case of a compiled binary meeting an architecture whose prebuilt was not the one
 * embedded, where degrading beats refusing to paste.
 */
async function nativeClipboard(): Promise<NativeClipboard | null> {
  if (native !== undefined) return native

  try {
    const loaded = await import('@mariozechner/clipboard')
    native = typeof loaded.hasImage === 'function' ? loaded : null
  } catch {
    native = null
  }

  return native
}

/**
 * Measured on an M-series machine against a 13.7 MB picture: `hasImage` answers in under a
 * millisecond warm and `getImageBase64` in 63 ms, where asking AppleScript for the same bytes takes
 * 1047 ms. That ratio is the whole reason the dependency is here — the tag has to land before the
 * paste keystroke is released, and no arrangement of a spawned `osascript` gets close.
 */
async function clipboardBytes(): Promise<Buffer | null> {
  const clipboard = await nativeClipboard()
  if (clipboard !== null) {
    if (!clipboard.hasImage()) return null
    return Buffer.from(await clipboard.getImageBase64(), 'base64')
  }

  return await appleScriptClipboardBytes()
}

/**
 * The fallback, for a machine the native module would not install on. The non-zero exit IS the
 * "is there an image?" test: `osascript` refuses the coercion for text, for an empty clipboard and
 * for a file promise alike, and none of those is an error worth reporting.
 */
export async function appleScriptClipboardBytes(): Promise<Buffer | null> {
  if (process.platform !== 'darwin') return null

  const read = Bun.spawn(['osascript', '-e', 'the clipboard as «class PNGf»'], {
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const [stdout, exitCode] = await Promise.all([new Response(read.stdout).text(), read.exited])
  if (exitCode !== 0) return null

  const match = PNG_HEX.exec(stdout)
  return match?.[1] === undefined ? null : Buffer.from(match[1], 'hex')
}

/**
 * An image cannot arrive through the paste channel. Bracketed paste is TEXT: OpenTUI's
 * `PasteMetadata` declares a `mimeType` and a `binary` kind but nothing populates them, and
 * `pbpaste` returns the empty string when the clipboard holds a picture. So the image is PULLED —
 * either on ctrl+v, or on the empty paste a terminal makes of a picture, which is the same signal
 * arriving by a different door.
 */
export const readClipboardImage: ClipboardImageReader = async ({ directory, tier }) =>
  await attachClipboardImage({ directory, tier, pull: clipboardBytes, memory: oneGesture })

/**
 * The paste is written at the size the model will actually read it — the tier projection, the same
 * number the token chip reports. Anthropic resizes server-side either way, but providers that do
 * not (a deployment with a fixed prefill budget rejects a 4K screenshot outright, which bricks the
 * turn) read exactly what is sent. A paste that cannot be re-encoded — a JPEG, an interlaced PNG,
 * a re-encode that comes out larger — keeps its original bytes; the resize never blocks a paste.
 */
function sizedBytes(args: {
  bytes: Buffer
  mediaType: SupportedImageMediaType
  size: { width: number; height: number }
  tier: EImageTier | undefined
}): { bytes: Buffer; size: { width: number; height: number } } {
  if (args.mediaType !== 'image/png') return { bytes: args.bytes, size: args.size }

  const target = projectedSize({ size: args.size, tier: args.tier })
  if (target.width === args.size.width && target.height === args.size.height) {
    return { bytes: args.bytes, size: args.size }
  }

  const scaled = downscalePng({ bytes: args.bytes, target, codec: pngCodec })
  if (scaled === null) return { bytes: args.bytes, size: args.size }

  return { bytes: Buffer.from(scaled), size: target }
}

async function writtenClipboardImage(args: {
  directory: string
  bytes: Buffer | null
  tier: EImageTier | undefined
}): Promise<ClipboardImage | null> {
  const { directory, bytes, tier } = args
  if (bytes === null) return null

  const mediaType = imageMediaType(bytes)
  if (mediaType === null) return null

  const size = imageSize({ bytes, mediaType })
  if (size === null) return null

  const sized = sizedBytes({ bytes, mediaType, size, tier })

  const path = join(directory, pasteName(EXTENSIONS[mediaType]))
  mkdirSync(directory, { recursive: true })
  writeFileSync(path, sized.bytes)

  const facts = { byteLength: sized.bytes.byteLength, ...sized.size, tier }
  const settled = planDelivery(facts)

  return {
    path,
    mediaType,
    byteLength: facts.byteLength,
    width: facts.width,
    height: facts.height,
    delivery: settled.delivery,
    tokens: visualTokens({ ...facts, tier }),
    ...(settled.reason === undefined ? {} : { reason: settled.reason }),
    tier,
  }
}

const oneGesture: PasteMemory = { written: new Map() }

export type PasteMemory = { written: Map<string, { digest: string; image: ClipboardImage }> }

export const newPasteMemory = (): PasteMemory => ({ written: new Map() })

const digestOf = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/**
 * One gesture can open both paste doors — a terminal that hands the application ctrl+v *and* makes
 * an empty paste of the picture asks twice for the same bytes. Remembering what was last written to
 * a directory keeps that one keystroke to one file and one tag, while a genuinely new picture, or
 * the same picture in another conversation, still gets a copy of its own. The tier is remembered
 * alongside: the same clipboard picture resizes to a different file at a different model tier, so
 * a paste after a model switch must write again rather than reuse the stale size.
 */
export async function attachClipboardImage(args: {
  directory: string
  tier?: EImageTier | undefined
  pull: () => Promise<Buffer | null>
  memory: PasteMemory
}): Promise<ClipboardImage | null> {
  const bytes = await args.pull()
  if (bytes === null) return null

  const digest = digestOf(bytes)
  const known = args.memory.written.get(args.directory)
  if (known !== undefined && known.digest === digest && known.image.tier === args.tier) {
    return known.image
  }

  const image = await writtenClipboardImage({ directory: args.directory, bytes, tier: args.tier })
  if (image === null) return null

  args.memory.written.set(args.directory, { digest, image })
  return image
}

export function readImageBase64(path: string): string | null {
  try {
    return readFileSync(path).toString('base64')
  } catch {
    return null
  }
}
