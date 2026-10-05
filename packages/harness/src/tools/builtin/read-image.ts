import {
  decodesAsImage,
  EImageDelivery,
  imageSize,
  planDelivery,
  type AgentFileSystemPort,
  type ImageSize,
  type ModelPart,
  type SupportedImageMediaType,
  type ThreadId,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { cacheReadImage } from './image-cache'

export type ImageReadOutput = {
  path: string
  mediaType: SupportedImageMediaType
  byteLength: number
  width?: number | undefined
  height?: number | undefined
  inlined: boolean
  cachePath?: string | undefined
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
  cachePath?: string | undefined
}): ImageReadOutput => ({
  path: args.path,
  mediaType: args.mediaType,
  byteLength: args.byteLength,
  width: args.size?.width,
  height: args.size?.height,
  inlined: args.inlined,
  ...(args.cachePath !== undefined ? { cachePath: args.cachePath } : {}),
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

const inlined = (args: {
  path: string
  mediaType: SupportedImageMediaType
  size: ImageSize | null
  byteLength: number
  bytes: Uint8Array
  cachePath?: string | undefined
}): ToolOutcome => {
  const summary = describe(args)
  const parts: readonly ModelPart[] = [
    { type: 'text', text: summary },
    {
      type: 'image',
      data: Buffer.from(args.bytes).toString('base64'),
      mediaType: args.mediaType,
      source: args.path,
      width: args.size?.width,
      height: args.size?.height,
    },
  ]

  return {
    ok: true,
    output: outputFor({ ...args, inlined: true, ...(args.cachePath !== undefined ? { cachePath: args.cachePath } : {}) }),
    modelText: summary,
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
  sessionDirFor?: ((threadId: ThreadId) => Promise<string | undefined>) | undefined
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

  if (!decodesAsImage({ bytes, mediaType })) {
    return textOnly({
      path,
      mediaType,
      size,
      byteLength,
      because: 'the file is not a valid image of its type and a model would reject it',
    })
  }

  const sessionDir = await args.sessionDirFor?.(args.threadId)
  const cached =
    sessionDir === undefined
      ? undefined
      : await cacheReadImage({
          sessionDir,
          bytes,
          mediaType,
          sourcePath: path,
          width: size?.width,
          height: size?.height,
        })

  return inlined({
    path,
    mediaType,
    size,
    byteLength,
    bytes,
    ...(cached !== undefined ? { cachePath: cached.cachePath } : {}),
  })
}
