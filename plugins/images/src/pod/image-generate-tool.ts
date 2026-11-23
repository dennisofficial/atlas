import { randomBytes } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'

import {
  decodeBase64,
  EImageDelivery,
  EToolEffect,
  imageMediaType,
  imageSize,
  planInlineDelivery,
  SchemaTool,
  supportedImageMediaTypeOf,
  TAKES_NO_PATHS,
  type ImageSize,
  type ModelPart,
  type SupportedImageMediaType,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { ECallStatus } from '@dltech/atlas-protocol'
import { z } from 'zod'

import {
  EGenerateRefusal,
  generateWithGateway,
  zdrImageModels,
  type GenerateImageInput,
} from './generate'

const DEFAULT_MODEL = 'google/gemini-3.1-flash-image'

const MAX_IMAGES = 8

const GENERATED_DIRECTORY = 'generated-images'

const ATLAS_SESSION_DIR_ENV = 'ATLAS_SESSION_DIR'

const KILOBYTE = 1024

const MEGABYTE = KILOBYTE * KILOBYTE

const NO_ACCOUNT =
  'This session has no Vercel AI Gateway account. Add a Vercel AI Gateway API key with /auth.'

const EXTENSIONS: Readonly<Record<SupportedImageMediaType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const inputSchema = z.strictObject({
  prompt: z.string().min(1),
  images: z.array(z.string().min(1)).max(MAX_IMAGES).optional(),
  model: z.string().min(1).default(DEFAULT_MODEL),
})

const description = [
  'Generate one image from a prompt, or edit the images it is given, through the Vercel AI Gateway.',
  'images are sandbox paths of pictures to edit, such as /atlas/home/uploads/photo.png; leave them out to draw from the prompt alone.',
  'One image comes back per call, written under this session and returned inline with its dimensions and weight. Run several calls in parallel to compare models or to get variants.',
  `The default model is ${DEFAULT_MODEL}, which is fast and cheap. Other gateway ids: microsoft/mai-image-2.7 for full source resolution, spacexai/grok-imagine-image-2.0 for a different look.`,
  'If the gateway enforces Zero Data Retention, a model without it is refused, and the refusal lists the models to use instead.',
  'The image model sees only the prompt and the images, never this conversation, so write the prompt out in full even when the request was two words.',
  'Before an edit, read the source image so the prompt can name what is in it.',
  'Name the exact thing to change and where it is in the picture. State the target material, colour or finish, and point to something in the picture that already has it when one exists.',
  'Then list the nearby things that must stay as they are, by name, plus the lighting, the shadows and the camera angle. Without this list a model repaints them too.',
  'Write one instruction per sentence with concrete, specific words such as matte, veneer, brushed brass or soft daylight. Leave out vague words such as nicer or modern.',
].join(' ')

export type ImageGenerateDeps = {
  generate?: typeof generateWithGateway | undefined
  zdrModels?: ((signal: AbortSignal) => Promise<readonly string[]>) | undefined
  now?: (() => Date) | undefined
}

type NamedSources =
  | { ok: true; images: readonly GenerateImageInput[] }
  | { ok: false; reason: string }

const humanBytes = (byteLength: number): string => {
  if (byteLength < KILOBYTE) return `${byteLength} B`
  if (byteLength < MEGABYTE) return `${Math.round(byteLength / KILOBYTE)} KB`
  return `${(byteLength / MEGABYTE).toFixed(1)} MB`
}

const dimensions = (size: ImageSize | null): string =>
  size === null ? 'unknown dimensions' : `${size.width}×${size.height}`

const stampOf = (at: Date): string => {
  const iso = at.toISOString()
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}`
}

const fileNameOf = (args: {
  model: string
  mediaType: SupportedImageMediaType
  at: Date
}): string =>
  `${stampOf(args.at)}-${args.model.replaceAll('/', '_')}-${randomBytes(2).toString('hex')}.${EXTENSIONS[args.mediaType]}`

const pictureParts = (args: {
  path: string
  mediaType: SupportedImageMediaType
  size: ImageSize | null
  summary: string
  bytes: Uint8Array
}): readonly ModelPart[] => [
  { type: 'text', text: args.summary },
  {
    type: 'image',
    bytes: { kind: 'inline', data: Buffer.from(args.bytes).toString('base64') },
    mediaType: args.mediaType,
    source: args.path,
    width: args.size?.width,
    height: args.size?.height,
  },
]

export class ImageGenerateTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'image_generate'
  readonly description = description
  readonly effect = EToolEffect.Write
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  private readonly generate: typeof generateWithGateway
  private readonly zdrModels: (signal: AbortSignal) => Promise<readonly string[]>
  private readonly now: () => Date

  constructor(
    private readonly ctx: PluginPodContext,
    deps: ImageGenerateDeps = {},
  ) {
    super()
    this.generate = deps.generate ?? generateWithGateway
    this.zdrModels = deps.zdrModels ?? zdrImageModels
    this.now = deps.now ?? (() => new Date())
  }

  protected override async run({
    input,
    signal,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const apiKey = await this.ctx.control.gateway.apiKey()
    if (apiKey === undefined) return { ok: false, reason: NO_ACCOUNT }

    const sessionDir = (await this.ctx.env?.())?.[ATLAS_SESSION_DIR_ENV]
    if (sessionDir === undefined || sessionDir === '') {
      return { ok: false, reason: 'this session has no directory to write a generated image into' }
    }

    const sources = await this.sourceImages({ paths: input.images ?? [], signal })
    if (!sources.ok) return { ok: false, reason: sources.reason }

    const generated = await this.generate({
      apiKey,
      model: input.model,
      prompt: input.prompt,
      images: sources.images,
      signal,
    })

    if (!generated.ok) {
      if (generated.refusal !== EGenerateRefusal.ZeroDataRetention) {
        return { ok: false, reason: generated.reason }
      }
      const models = await this.zdrModels(signal)
      return {
        ok: false,
        reason: `${input.model} cannot run under this gateway's Zero Data Retention policy. Call image_generate again with a model that supports ZDR: ${models.join(', ')}. Gateway said: ${generated.reason}`,
      }
    }

    const mediaType = supportedImageMediaTypeOf(generated.mediaType)
    if (mediaType === null) {
      return {
        ok: false,
        reason: `${input.model} answered with ${generated.mediaType}, which image_generate cannot show`,
      }
    }

    const directory = join(sessionDir, GENERATED_DIRECTORY)
    const path = join(directory, fileNameOf({ model: input.model, mediaType, at: this.now() }))
    const refused = await this.save({ directory, path, bytes: generated.bytes, signal })
    if (refused !== undefined) return { ok: false, reason: refused }

    const byteLength = generated.bytes.byteLength
    const size = imageSize({ bytes: generated.bytes, mediaType })
    const plan = planInlineDelivery({ byteLength, width: size?.width, height: size?.height })
    const summary = `Generated ${path} with ${input.model} — ${mediaType}, ${dimensions(size)}, ${humanBytes(byteLength)}.`
    const output = {
      path,
      mediaType,
      byteLength,
      width: size?.width,
      height: size?.height,
      inlined: plan.delivery !== EImageDelivery.PathOnly,
      model: input.model,
    }

    if (plan.delivery === EImageDelivery.PathOnly) {
      return {
        ok: true,
        output,
        modelText: `${summary} It was not sent to you because ${plan.reason ?? 'it is too large to inline'}.`,
      }
    }

    return {
      ok: true,
      output,
      modelText: summary,
      modelParts: pictureParts({ path, mediaType, size, summary, bytes: generated.bytes }),
    }
  }

  private async sourceImages(args: {
    paths: readonly string[]
    signal: AbortSignal
  }): Promise<NamedSources> {
    const images: GenerateImageInput[] = []

    for (const path of args.paths) {
      const read = await this.readImage({ path, signal: args.signal })
      if (!read.ok) return read
      images.push(read.image)
    }

    return { ok: true, images }
  }

  private async readImage(args: {
    path: string
    signal: AbortSignal
  }): Promise<{ ok: true; image: GenerateImageInput } | { ok: false; reason: string }> {
    if (!isAbsolute(args.path)) {
      return {
        ok: false,
        reason: `${args.path} is not an absolute path; name the image as the sandbox stores it, such as /atlas/home/uploads/photo.png`,
      }
    }

    const read = await this.ctx.call({ op: 'readBytes', path: args.path }, { signal: args.signal })
    if (read.status === ECallStatus.Failed) {
      return { ok: false, reason: `could not read ${args.path}: ${read.error.message}` }
    }
    if (read.op !== 'readBytes') {
      return { ok: false, reason: `could not read ${args.path}: the daemon answered ${read.op}` }
    }

    const bytes = decodeBase64(read.value)
    const mediaType = imageMediaType(bytes)
    if (mediaType === null) {
      return { ok: false, reason: `${args.path} is not a png, jpeg, webp or gif image` }
    }

    return { ok: true, image: { bytes, mediaType } }
  }

  private async save(args: {
    directory: string
    path: string
    bytes: Uint8Array
    signal: AbortSignal
  }): Promise<string | undefined> {
    const folder = args.directory === '' ? dirname(args.path) : args.directory
    const made = await this.ctx.call({ op: 'mkdir', path: folder }, { signal: args.signal })
    if (made.status === ECallStatus.Failed) {
      return `could not create ${folder}: ${made.error.message}`
    }

    const written = await this.ctx.call(
      {
        op: 'writeFile',
        path: args.path,
        content: Buffer.from(args.bytes).toString('base64'),
        encoding: 'base64',
      },
      { signal: args.signal },
    )
    if (written.status === ECallStatus.Failed) {
      return `could not write ${args.path}: ${written.error.message}`
    }

    return undefined
  }
}
