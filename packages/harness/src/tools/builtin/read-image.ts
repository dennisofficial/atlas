import {
  downscalePng,
  EImageDelivery,
  imageSize,
  OPENAI_COMPLETIONS_API,
  planDelivery,
  projectedSize,
  type AgentFileSystemPort,
  type ImageSize,
  type ModelCard,
  type ModelPart,
  type SupportedImageMediaType,
  type ThreadId,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { zlibPngCodec } from '../../images/png-codec'

export type ImageResizeDecision = {
  workaroundEnabled: () => boolean
  card: () => ModelCard | undefined
}

export type ImageReadOutput = {
  path: string
  mediaType: SupportedImageMediaType
  byteLength: number
  width?: number | undefined
  height?: number | undefined
  inlined: boolean
}

const KILOBYTE = 1024

export function humanBytes(byteLength: number): string {
  if (byteLength < KILOBYTE) return `${byteLength} B`
  if (byteLength < KILOBYTE * KILOBYTE) return `${Math.round(byteLength / KILOBYTE)} KB`
  return `${(byteLength / KILOBYTE / KILOBYTE).toFixed(1)} MB`
}

const dimensions = (size: ImageSize | null): string =>
  size === null ? 'unknown dimensions' : `${size.width}×${size.height}`

const describe = (args: {
  path: string
  mediaType: SupportedImageMediaType
  size: ImageSize | null
  byteLength: number
}): string =>
  `${args.path} — ${args.mediaType}, ${dimensions(args.size)}, ${humanBytes(args.byteLength)}.`

const outputFor = (args: {
  path: string
  mediaType: SupportedImageMediaType
  size: ImageSize | null
  byteLength: number
  inlined: boolean
}): ImageReadOutput => ({
  path: args.path,
  mediaType: args.mediaType,
  byteLength: args.byteLength,
  width: args.size?.width,
  height: args.size?.height,
  inlined: args.inlined,
})

const textOnly = (args: {
  path: string
  mediaType: SupportedImageMediaType
  size: ImageSize | null
  byteLength: number
  because: string
}): ToolOutcome => ({
  ok: true,
  output: outputFor({ ...args, inlined: false }),
  modelText: `${describe(args)} It was not sent to you because ${args.because}.`,
})

const resizedFor = (args: {
  resize: ImageResizeDecision | undefined
  mediaType: SupportedImageMediaType
  size: ImageSize | null
  bytes: Uint8Array
}): { size: ImageSize; bytes: Uint8Array } | null => {
  if (args.resize === undefined || !args.resize.workaroundEnabled()) return null
  if (args.mediaType !== 'image/png') return null
  if (args.size === null) return null

  const card = args.resize.card()
  if (card?.api !== OPENAI_COMPLETIONS_API) return null

  const target = projectedSize({ size: args.size, tier: card.imageTier })
  if (target.width === args.size.width && target.height === args.size.height) return null

  const scaled = downscalePng({ bytes: args.bytes, target, codec: zlibPngCodec })
  return scaled === null ? null : { size: target, bytes: scaled }
}

const inlined = (args: {
  path: string
  mediaType: SupportedImageMediaType
  size: ImageSize | null
  byteLength: number
  bytes: Uint8Array
  resize?: ImageResizeDecision | undefined
}): ToolOutcome => {
  const resized = resizedFor({
    resize: args.resize,
    mediaType: args.mediaType,
    size: args.size,
    bytes: args.bytes,
  })

  const delivered = resized
    ? { size: resized.size, byteLength: resized.bytes.byteLength, bytes: resized.bytes }
    : { size: args.size, byteLength: args.byteLength, bytes: args.bytes }

  const summary = describe({
    path: args.path,
    mediaType: args.mediaType,
    size: delivered.size,
    byteLength: delivered.byteLength,
  })
  const note = resized && args.size !== null ? ` Downscaled from ${args.size.width}×${args.size.height}.` : ''
  const parts: readonly ModelPart[] = [
    { type: 'text', text: summary + note },
    {
      type: 'image',
      data: Buffer.from(delivered.bytes).toString('base64'),
      mediaType: args.mediaType,
      source: args.path,
      width: delivered.size?.width,
      height: delivered.size?.height,
    },
  ]

  return {
    ok: true,
    output: outputFor({
      path: args.path,
      mediaType: args.mediaType,
      size: delivered.size,
      byteLength: delivered.byteLength,
      inlined: true,
    }),
    modelText: summary + note,
    modelParts: parts,
  }
}

export async function readImage(args: {
  path: string
  mediaType: SupportedImageMediaType
  byteLength: number
  head: Uint8Array
  files: AgentFileSystemPort
  threadId: ThreadId
  resize?: ImageResizeDecision | undefined
}): Promise<ToolOutcome> {
  const { path, mediaType, byteLength } = args

  const size = imageSize({ bytes: args.head, mediaType })

  const plan = planDelivery({ byteLength, width: size?.width, height: size?.height })

  if (plan.delivery === EImageDelivery.PathOnly) {
    return textOnly({
      path,
      mediaType,
      size,
      byteLength,
      because: plan.reason ?? `${humanBytes(byteLength)} is too large to inline`,
    })
  }

  const bytes = await args.files.readBytes({ path, threadId: args.threadId })

  return inlined({ path, mediaType, size, byteLength, bytes, resize: args.resize })
}
