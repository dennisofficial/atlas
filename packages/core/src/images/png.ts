import { pngSize, type ImageSize } from './limits'

/**
 * A raster PNG: decoded to interleaved samples, filtered rows rebuilt to filter type 0, and the
 * interlace pass refused outright — an Adam7 picture falls back to its original bytes rather than
 * risk a mangled decode.
 *
 * zlib (inflate/deflate) is injected as a port: core performs no I/O and imports no node builtins,
 * so the caller — the TUI — supplies `node:zlib`'s implementations. The codec itself is pure.
 */
export type PngCodec = {
  inflate: (bytes: Uint8Array) => Uint8Array
  deflate: (bytes: Uint8Array) => Uint8Array
}

const SIGNATURE_LENGTH = 8

const readUint32BE = (bytes: Uint8Array, offset: number): number =>
  (((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)) >>> 0

type PngHeader = { size: ImageSize; bitDepth: number; colourType: number }

/** Samples per pixel by colour type (PNG spec section 6.1): grey 1, rgb 3, indexed 1, grey+alpha 2, rgba 4. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function parseChunks(bytes: Uint8Array): { header: PngHeader; palette: Uint8Array | null; idat: Uint8Array[] } | null {
  const size = pngSize(bytes)
  if (size === null) return null

  let header: PngHeader | null = null
  let palette: Uint8Array | null = null
  const idat: Uint8Array[] = []

  let offset = SIGNATURE_LENGTH
  while (offset + 12 <= bytes.byteLength) {
    const length = readUint32BE(bytes, offset)
    const type = String.fromCharCode(bytes[offset + 4] ?? 0, bytes[offset + 5] ?? 0, bytes[offset + 6] ?? 0, bytes[offset + 7] ?? 0)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (data.byteLength < length) return null

    if (type === 'IHDR') {
      if (length !== 13) return null
      const interlace = bytes[offset + 8 + 12] ?? 0
      if (interlace !== 0) return null
      header = { size, bitDepth: bytes[offset + 8 + 8] ?? 0, colourType: bytes[offset + 8 + 9] ?? 0 }
    } else if (type === 'PLTE') {
      palette = new Uint8Array(data)
    } else if (type === 'IDAT') {
      idat.push(new Uint8Array(data))
    } else if (type === 'IEND') {
      break
    }

    offset += 12 + length
  }

  return header === null ? null : { header, palette, idat }
}

function unpackRowBits(row: Uint8Array, width: number, depth: number): Uint8Array {
  const samples = new Uint8Array(width)
  const mask = (1 << depth) - 1
  const perByte = 8 / depth

  for (let pixel = 0; pixel < width; pixel += 1) {
    const byte = row[Math.floor(pixel / perByte)] ?? 0
    const shift = 8 - depth * ((pixel % perByte) + 1)
    samples[pixel] = (byte >>> shift) & mask
  }

  return samples
}

/**
 * Reverses the row filters (PNG spec section 6.6). `left`/`upLeft` step back one full PIXEL, not
 * one byte — for an RGBA row that is four bytes, and mistaking it for one decodes a subtly wrong
 * picture that still passes every structural check.
 */
function unfilter(args: {
  raw: Uint8Array
  size: ImageSize
  scanlineBytes: number
  pixelBytes: number
}): Uint8Array | null {
  const { raw, size, scanlineBytes, pixelBytes } = args
  const expected = size.height * (1 + scanlineBytes)
  if (raw.byteLength < expected) return null

  const rows = new Uint8Array(size.height * scanlineBytes)
  let prior = rows.subarray(0, 0)

  for (let y = 0; y < size.height; y += 1) {
    const start = y * (1 + scanlineBytes)
    const filter = raw[start] ?? 0
    if (filter > 4) return null

    const row = rows.subarray(y * scanlineBytes, (y + 1) * scanlineBytes)
    for (let x = 0; x < scanlineBytes; x += 1) {
      const value = raw[start + 1 + x] ?? 0
      const left = x >= pixelBytes ? (row[x - pixelBytes] ?? 0) : 0
      const up = prior[x] ?? 0
      const upLeft = x >= pixelBytes ? (prior[x - pixelBytes] ?? 0) : 0

      if (filter === 0) row[x] = value
      else if (filter === 1) row[x] = (value + left) & 0xff
      else if (filter === 2) row[x] = (value + up) & 0xff
      else if (filter === 3) row[x] = (value + Math.floor((left + up) / 2)) & 0xff
      else {
        const p = left + up - upLeft
        const toLeft = Math.abs(p - left)
        const toUp = Math.abs(p - up)
        const toUpLeft = Math.abs(p - upLeft)
        row[x] = (value + (toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft)) & 0xff
      }
    }

    prior = row
  }

  return rows
}

export type RgbaImage = { size: ImageSize; rgba: Uint8Array }

/**
 * Decodes a PNG to 8-bit RGBA. Returns null for anything outside what the resizer honours:
 * interlaced pictures, 16-bit channels, malformed streams — the caller falls back to the original
 * bytes, so a refusal is never a lost image.
 */
export function decodePng(bytes: Uint8Array, codec: PngCodec): RgbaImage | null {
  const parsed = parseChunks(bytes)
  if (parsed === null || parsed.idat.length === 0) return null
  const { header, palette, idat } = parsed

  const channels = CHANNELS[header.colourType]
  if (channels === undefined) return null
  if (header.bitDepth !== 8 && header.bitDepth !== 4 && header.bitDepth !== 2 && header.bitDepth !== 1) return null
  if (header.bitDepth !== 8 && header.colourType !== 0 && header.colourType !== 3) return null
  if (header.colourType === 3 && palette === null) return null

  const { width, height } = header.size
  if (width <= 0 || height <= 0) return null

  const scanlineBytes = Math.ceil((width * channels * header.bitDepth) / 8)

  let inflated: Uint8Array
  try {
    inflated = new Uint8Array(codec.inflate(joinBytes(idat)))
  } catch {
    return null
  }

  const pixelBytes = Math.max(1, Math.ceil((channels * header.bitDepth) / 8))
  const rows = unfilter({ raw: inflated, size: header.size, scanlineBytes, pixelBytes })
  if (rows === null) return null

  const rgba = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y += 1) {
    const row = rows.subarray(y * scanlineBytes, (y + 1) * scanlineBytes)
    const packed = header.bitDepth === 8 ? null : unpackRowBits(row, width * channels, header.bitDepth)

    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4

      if (packed !== null) {
        const index = packed[x] ?? 0
        if (header.colourType === 3) {
          rgba[at] = palette?.[index * 3] ?? 0
          rgba[at + 1] = palette?.[index * 3 + 1] ?? 0
          rgba[at + 2] = palette?.[index * 3 + 2] ?? 0
          rgba[at + 3] = 255
        } else {
          const shade = Math.round((index * 255) / ((1 << header.bitDepth) - 1))
          rgba[at] = shade
          rgba[at + 1] = shade
          rgba[at + 2] = shade
          rgba[at + 3] = 255
        }
        continue
      }

      const sample = x * channels
      if (header.colourType === 0) {
        const shade = row[sample] ?? 0
        rgba[at] = shade
        rgba[at + 1] = shade
        rgba[at + 2] = shade
        rgba[at + 3] = 255
      } else if (header.colourType === 2) {
        rgba[at] = row[sample] ?? 0
        rgba[at + 1] = row[sample + 1] ?? 0
        rgba[at + 2] = row[sample + 2] ?? 0
        rgba[at + 3] = 255
      } else if (header.colourType === 3) {
        const index = row[sample] ?? 0
        rgba[at] = palette?.[index * 3] ?? 0
        rgba[at + 1] = palette?.[index * 3 + 1] ?? 0
        rgba[at + 2] = palette?.[index * 3 + 2] ?? 0
        rgba[at + 3] = 255
      } else if (header.colourType === 4) {
        const shade = row[sample] ?? 0
        rgba[at] = shade
        rgba[at + 1] = shade
        rgba[at + 2] = shade
        rgba[at + 3] = row[sample + 1] ?? 255
      } else {
        rgba[at] = row[sample] ?? 0
        rgba[at + 1] = row[sample + 1] ?? 0
        rgba[at + 2] = row[sample + 2] ?? 0
        rgba[at + 3] = row[sample + 3] ?? 255
      }
    }
  }

  return { size: header.size, rgba }
}

const joinBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const uint32BEBytes = (value: number): Uint8Array =>
  new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])

const CRC_TABLE = Array.from({ length: 256 }, (_unused, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

const crc32 = (bytes: Uint8Array): number => {
  let value = 0xffffffff
  for (const byte of bytes) value = (CRC_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

const encodeChunk = (type: string, data: Uint8Array): Uint8Array => {
  const body = joinBytes([new Uint8Array([...type].map((c) => c.charCodeAt(0))), data])
  return joinBytes([uint32BEBytes(data.length), body, uint32BEBytes(crc32(body))])
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Encodes 8-bit RGBA as a filter-0 PNG. IDAT is a zlib stream (RFC 1950), not raw DEFLATE. */
/**
 * Picks the row filter that costs the least — the sum of absolute differences from the byte's
 * signed interpretation, the classic MSAD heuristic. A downscaled screenshot is mostly smooth
 * runs, where Sub/Up beat filter 0 by a wide margin; without this the re-encode can come out
 * larger than the original the clipboard handed us. Bytes above 127 score as negative, so a
 * residual of 255 (one off, the wrong way) costs 1, not 255.
 */
function filterRow(args: { row: Uint8Array; prior: Uint8Array | null; pixelBytes: number }): Uint8Array {
  const { row, prior, pixelBytes } = args
  const stride = row.byteLength

  const raw = new Uint8Array(stride)
  const sub = new Uint8Array(stride)
  const up = new Uint8Array(stride)
  const average = new Uint8Array(stride)

  let rawScore = 0
  let subScore = 0
  let upScore = 0
  let averageScore = 0

  const signed = (byte: number): number => (byte < 128 ? byte : 256 - byte)

  for (let x = 0; x < stride; x += 1) {
    const value = row[x] ?? 0
    const left = x >= pixelBytes ? (row[x - pixelBytes] ?? 0) : 0
    const above = prior?.[x] ?? 0

    const subbed = (value - left) & 0xff
    const upped = (value - above) & 0xff
    const averaged = (value - Math.floor((left + above) / 2)) & 0xff

    raw[x] = value
    sub[x] = subbed
    up[x] = upped
    average[x] = averaged

    rawScore += signed(value)
    subScore += signed(subbed)
    upScore += signed(upped)
    averageScore += signed(averaged)
  }

  let best = { filter: 0, bytes: raw, score: rawScore }
  for (const candidate of [
    { filter: 1, bytes: sub, score: subScore },
    { filter: 2, bytes: up, score: upScore },
    { filter: 3, bytes: average, score: averageScore },
  ]) {
    if (candidate.score < best.score) best = candidate
  }

  return joinBytes([new Uint8Array([best.filter]), best.bytes])
}

export function encodePng(image: RgbaImage, codec: PngCodec): Uint8Array {
  const { width, height } = image.size
  const stride = width * 4
  const filtered = new Uint8Array(height * (1 + stride))

  let prior: Uint8Array | null = null
  for (let y = 0; y < height; y += 1) {
    const row = image.rgba.subarray(y * stride, (y + 1) * stride)
    const filtered_row = filterRow({ row: new Uint8Array(row), prior, pixelBytes: 4 })
    filtered.set(filtered_row, y * (1 + stride))
    prior = new Uint8Array(row)
  }

  const header = joinBytes([uint32BEBytes(width), uint32BEBytes(height), new Uint8Array([8, 6, 0, 0, 0])])

  return joinBytes([
    PNG_SIGNATURE,
    encodeChunk('IHDR', header),
    encodeChunk('IDAT', new Uint8Array(codec.deflate(filtered))),
    encodeChunk('IEND', new Uint8Array(0)),
  ])
}

/**
 * Box-downscales an RGBA raster: each output pixel is the area-weighted average of the source
 * pixels beneath it, so thin lines and text survive where nearest-neighbour drops them. Two
 * passes — horizontal, then vertical — keep it O(width × height × ratio) rather than quadratic.
 */
export function downscaleRgba(image: RgbaImage, target: ImageSize): RgbaImage {
  const { width, height } = image.size
  const { width: outWidth, height: outHeight } = target

  if (outWidth >= width && outHeight >= height) return { size: image.size, rgba: new Uint8Array(image.rgba) }

  const horizontal = new Uint8Array(outWidth * height * 4)
  const xRatio = width / outWidth

  for (let y = 0; y < height; y += 1) {
    for (let ox = 0; ox < outWidth; ox += 1) {
      const from = ox * xRatio
      const to = (ox + 1) * xRatio
      const first = Math.floor(from)
      const last = Math.min(Math.ceil(to), width)

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sx = first; sx < last; sx += 1) {
        const cover = Math.min(to, sx + 1) - Math.max(from, sx)
        const at = (y * width + sx) * 4
        r += (image.rgba[at] ?? 0) * cover
        g += (image.rgba[at + 1] ?? 0) * cover
        b += (image.rgba[at + 2] ?? 0) * cover
        a += (image.rgba[at + 3] ?? 0) * cover
      }

      const span = to - from
      const out = (y * outWidth + ox) * 4
      horizontal[out] = Math.round(r / span)
      horizontal[out + 1] = Math.round(g / span)
      horizontal[out + 2] = Math.round(b / span)
      horizontal[out + 3] = Math.round(a / span)
    }
  }

  const scaled = new Uint8Array(outWidth * outHeight * 4)
  const yRatio = height / outHeight

  for (let oy = 0; oy < outHeight; oy += 1) {
    const from = oy * yRatio
    const to = (oy + 1) * yRatio
    const first = Math.floor(from)
    const last = Math.min(Math.ceil(to), height)

    for (let ox = 0; ox < outWidth; ox += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = first; sy < last; sy += 1) {
        const cover = Math.min(to, sy + 1) - Math.max(from, sy)
        const at = (sy * outWidth + ox) * 4
        r += (horizontal[at] ?? 0) * cover
        g += (horizontal[at + 1] ?? 0) * cover
        b += (horizontal[at + 2] ?? 0) * cover
        a += (horizontal[at + 3] ?? 0) * cover
      }

      const span = to - from
      const out = (oy * outWidth + ox) * 4
      scaled[out] = Math.round(r / span)
      scaled[out + 1] = Math.round(g / span)
      scaled[out + 2] = Math.round(b / span)
      scaled[out + 3] = Math.round(a / span)
    }
  }

  return { size: { width: outWidth, height: outHeight }, rgba: scaled }
}

/**
 * Re-encodes a PNG at a smaller size, or returns null — never a worse picture: an undecodable
 * stream, an upscale, or a re-encode that comes out LARGER than the original all refuse, and the
 * caller keeps the original bytes.
 */
export function downscalePng(args: { bytes: Uint8Array; target: ImageSize; codec: PngCodec }): Uint8Array | null {
  const decoded = decodePng(args.bytes, args.codec)
  if (decoded === null) return null
  if (args.target.width >= decoded.size.width && args.target.height >= decoded.size.height) return null

  const encoded = encodePng(downscaleRgba(decoded, args.target), args.codec)
  return encoded.byteLength < args.bytes.byteLength ? encoded : null
}
