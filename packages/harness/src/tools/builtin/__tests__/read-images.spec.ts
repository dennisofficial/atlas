import {
  decodeBase64,
  EImageTier,
  encodePng,
  MAX_API_EDGE,
  MAX_INLINE_BYTES,
  OPENAI_COMPLETIONS_API,
  pngSize,
  projectedSize,
  toThreadId,
  type ModelCard,
} from '@dltech/atlas-core'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'bun:test'

import { zlibPngCodec } from '../../../images/png-codec'
import { ReadTool } from '../read'
import type { ImageReadOutput } from '../read-image'

const bigEndian32 = (value: number): number[] => [
  (value >> 24) & 0xff,
  (value >> 16) & 0xff,
  (value >> 8) & 0xff,
  value & 0xff,
]

const png = (args: { width: number; height: number; padding?: number }): Uint8Array =>
  new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...bigEndian32(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...bigEndian32(args.width),
    ...bigEndian32(args.height),
    ...Array.from({ length: args.padding ?? 0 }, (_, index) => index % 251),
  ])

let root = ''

const paths = {
  small: '',
  wide: '',
  enormous: '',
  heavy: '',
  text: '',
  misnamed: '',
  real: '',
}

const solidPng = (args: { width: number; height: number }): Uint8Array => {
  const rgba = new Uint8Array(args.width * args.height * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 120
    rgba[i + 1] = 60
    rgba[i + 2] = 200
    rgba[i + 3] = 255
  }
  return encodePng({ size: { width: args.width, height: args.height }, rgba }, zlibPngCodec)
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-read-images-'))

  paths.small = join(root, 'shot.png')
  paths.wide = join(root, 'retina.png')
  paths.enormous = join(root, 'enormous.png')
  paths.heavy = join(root, 'huge.png')
  paths.text = join(root, 'notes.txt')
  paths.misnamed = join(root, 'not-really.txt')
  paths.real = join(root, 'real-shot.png')

  await writeFile(paths.real, solidPng({ width: 4000, height: 3000 }))

  await writeFile(paths.small, png({ width: 1024, height: 768, padding: 400 * 1024 }))
  await writeFile(paths.wide, png({ width: 4000, height: 3000 }))
  await writeFile(paths.enormous, png({ width: MAX_API_EDGE + 1, height: 100 }))
  await writeFile(paths.heavy, png({ width: 800, height: 600, padding: MAX_INLINE_BYTES + 1 }))
  await writeFile(paths.text, 'alpha\nbravo\n')
  await writeFile(paths.misnamed, png({ width: 32, height: 16 }))
})

const tool = new ReadTool()

const read = async (path: string) =>
  await tool.invoke({
    input: { path },
    signal: new AbortController().signal,
    idempotencyKey: 'read-images',
    projectDirectory: '/workspace',
    threadId: toThreadId('thread-1'),
  })

const settled = async (path: string) => {
  const outcome = await read(path)
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome
}

const imageOutput = (output: unknown): ImageReadOutput => output as ImageReadOutput

describe('read on an image', () => {
  it('returns a text part naming the file and an image part carrying its bytes', async () => {
    const outcome = await settled(paths.small)

    expect(outcome.modelParts).toEqual([
      { type: 'text', text: `${paths.small} — image/png, 1024×768, 400 KB.` },
      {
        type: 'image',
        data: expect.any(String),
        mediaType: 'image/png',
        source: paths.small,
        width: 1024,
        height: 768,
      },
    ])

    const part = outcome.modelParts?.[1]
    if (part === undefined || part.type !== 'image') throw new Error('expected an image part')
    expect(decodeBase64(part.data).byteLength).toBe(400 * 1024 + 24)
  })

  it('reports the picture rather than a line count', async () => {
    const output = imageOutput((await settled(paths.small)).output)

    expect(output).toEqual({
      path: paths.small,
      mediaType: 'image/png',
      byteLength: 400 * 1024 + 24,
      width: 1024,
      height: 768,
      inlined: true,
    })
  })

  it('does not claim a whole-file reveal, so an image read cannot unlock an edit', async () => {
    const outcome = await settled(paths.small)

    expect(tool.revealsWholeFile?.({ input: { path: paths.small }, output: outcome.output })).toBe(
      false,
    )
  })

  it('sniffs the bytes, not the extension', async () => {
    const outcome = await settled(paths.misnamed)

    expect(imageOutput(outcome.output).mediaType).toBe('image/png')
    expect(outcome.modelParts).toHaveLength(2)
  })
})

describe('read on an image past the long edge', () => {
  it('sends it whole, because the API downscales what it will not read at full size', async () => {
    const outcome = await settled(paths.wide)

    expect(outcome.modelText).toBe(`${paths.wide} — image/png, 4000×3000, 24 B.`)
    expect(outcome.modelParts).toHaveLength(2)
    expect(imageOutput(outcome.output).inlined).toBe(true)
  })
})

describe('read on an image it cannot send', () => {
  it('declines past the edge the API refuses outright', async () => {
    const outcome = await settled(paths.enormous)

    expect(outcome.modelParts).toBeUndefined()
    expect(outcome.modelText).toContain(`past the ${MAX_API_EDGE} the API accepts`)
    expect(imageOutput(outcome.output).inlined).toBe(false)
  })

  it('gives the size as the reason when the file is past the inline ceiling', async () => {
    const outcome = await settled(paths.heavy)

    expect(outcome.modelParts).toBeUndefined()
    expect(outcome.modelText).toContain('is past the 5.0 MB inline limit')
    expect(imageOutput(outcome.output)).toMatchObject({
      width: 800,
      height: 600,
      inlined: false,
    })
  })
})

const completionsCard: ModelCard = {
  ref: { providerId: 'inference', modelId: 'kimi-k3' },
  label: 'Kimi K3',
  api: OPENAI_COMPLETIONS_API,
  contextWindow: 1_048_576,
  imageTier: EImageTier.Standard,
}

const gated = (args: { enabled: boolean; card?: ModelCard }): ReadTool =>
  new ReadTool({
    imageResize: {
      workaroundEnabled: () => args.enabled,
      card: () => args.card,
    },
  })

const readWith = async (tool: ReadTool, path: string) => {
  const outcome = await tool.invoke({
    input: { path },
    signal: new AbortController().signal,
    idempotencyKey: 'read-images-resize',
    projectDirectory: '/workspace',
    threadId: toThreadId('thread-1'),
  })
  if (!outcome.ok) throw new Error((outcome as { reason: string }).reason)
  return outcome
}

describe('read on an oversized PNG with the multimodal cap workaround', () => {
  it('downscales to the tier projection for a completions model while the toggle is on', async () => {
    const outcome = await readWith(gated({ enabled: true, card: completionsCard }), paths.real)
    const expected = projectedSize({ size: { width: 4000, height: 3000 } })

    const output = imageOutput(outcome.output)
    expect({ width: output.width, height: output.height }).toEqual(expected)

    const part = outcome.modelParts?.[1]
    if (part?.type !== 'image') throw new Error('expected an image part')
    const delivered = decodeBase64(part.data)
    expect(pngSize(delivered)).toEqual(expected)
    expect(output.byteLength).toBe(delivered.byteLength)
    expect(outcome.modelText).toContain('Downscaled from 4000×3000.')
  })

  it('sends the original bytes for a model that rescales server-side even while on', async () => {
    const messagesCard: ModelCard = { ...completionsCard, api: 'messages' }
    const outcome = await readWith(gated({ enabled: true, card: messagesCard }), paths.real)

    const part = outcome.modelParts?.[1]
    if (part?.type !== 'image') throw new Error('expected an image part')
    const original = await readFile(paths.real)
    expect(decodeBase64(part.data)).toEqual(new Uint8Array(original))
    expect(imageOutput(outcome.output).width).toBe(4000)
  })

  it('sends the original bytes while the toggle is off', async () => {
    const outcome = await readWith(gated({ enabled: false, card: completionsCard }), paths.real)

    const part = outcome.modelParts?.[1]
    if (part?.type !== 'image') throw new Error('expected an image part')
    expect(pngSize(decodeBase64(part.data))).toEqual({ width: 4000, height: 3000 })
    expect(outcome.modelText).not.toContain('Downscaled from')
  })

  it('keeps the original bytes when the PNG cannot be re-encoded', async () => {
    const outcome = await readWith(gated({ enabled: true, card: completionsCard }), paths.wide)

    const part = outcome.modelParts?.[1]
    if (part?.type !== 'image') throw new Error('expected an image part')
    expect(decodeBase64(part.data).byteLength).toBe(24)
    expect(imageOutput(outcome.output).width).toBe(4000)
    expect(outcome.modelText).not.toContain('Downscaled from')
  })
})

describe('read on a text file', () => {
  it('is unchanged', async () => {
    const outcome = await settled(paths.text)

    expect(outcome.modelParts).toBeUndefined()
    expect(outcome.modelText).toBe('1\talpha\n2\tbravo')
    expect(outcome.output).toEqual({ path: paths.text, lines: 2, truncated: false })
  })

  it('still turns away a binary file that is not an image', async () => {
    const path = join(root, 'blob.bin')
    await writeFile(path, new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x02]))

    const outcome = await read(path)

    expect(outcome).toEqual({
      ok: false,
      reason: `${path} looks like a binary file and cannot be read as text.`,
    })
  })
})
