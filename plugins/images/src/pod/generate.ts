import { createGateway } from '@ai-sdk/gateway'
import {
  generateImage,
  generateText,
  type ImageModel,
  type LanguageModel,
  type ModelMessage,
} from 'ai'
import { z } from 'zod'

export enum EGenerateRefusal {
  ZeroDataRetention = 'zero-data-retention',
  Failed = 'failed',
}

export enum EGenerateRoute {
  Text = 'text',
  Image = 'image',
}

export type GenerateImageInput = { bytes: Uint8Array; mediaType: string }

export type SdkPicture = { uint8Array: Uint8Array; mediaType: string }

export type GenerateOutcome =
  | { ok: true; bytes: Uint8Array; mediaType: string }
  | { ok: false; refusal: EGenerateRefusal; reason: string }

type ImageCall = (args: {
  model: ImageModel
  prompt: string | { images: Uint8Array[]; text: string }
  abortSignal: AbortSignal
}) => Promise<{ images: readonly SdkPicture[] }>

type TextCall = (args: {
  model: LanguageModel
  messages: ModelMessage[]
  abortSignal: AbortSignal
}) => Promise<{ files: readonly SdkPicture[] }>

export type GenerateSdk = { image: ImageCall; text: TextCall }

export const GATEWAY_MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models'

export const ZDR_FALLBACK_MODELS: readonly string[] = [
  'google/gemini-3.1-flash-image',
  'microsoft/mai-image-2.7',
]

const NO_SDK_RETRIES = 0

const ZDR_MARKERS: readonly string[] = [
  'no_zdr_providers_available',
  'zdr_ineligible_model',
  'zero data retention',
  'zdr',
]

const DEFAULT_SDK: GenerateSdk = {
  image: async (args) => await generateImage({ ...args, n: 1, maxRetries: NO_SDK_RETRIES }),
  text: async (args) => await generateText({ ...args, maxRetries: NO_SDK_RETRIES }),
}

const modelEntrySchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  zdr: z.string().optional(),
})

const modelsPayloadSchema = z.object({ data: z.array(z.unknown()) })

const isImageEntry = (entry: z.infer<typeof modelEntrySchema>): boolean =>
  entry.type === 'image' || entry.id.endsWith('-image')

export function zdrImageModelsIn(payload: unknown): readonly string[] {
  const parsed = modelsPayloadSchema.safeParse(payload)
  if (!parsed.success) return []

  return parsed.data.data.flatMap((entry) => {
    const model = modelEntrySchema.safeParse(entry)
    if (!model.success) return []
    if (!isImageEntry(model.data)) return []
    if (model.data.zdr === undefined || model.data.zdr === 'none') return []
    return [model.data.id]
  })
}

export async function zdrImageModels(signal: AbortSignal): Promise<readonly string[]> {
  try {
    const response = await fetch(GATEWAY_MODELS_URL, { signal })
    if (!response.ok) return ZDR_FALLBACK_MODELS
    const models = zdrImageModelsIn(await response.json())
    return models.length === 0 ? ZDR_FALLBACK_MODELS : models
  } catch {
    return ZDR_FALLBACK_MODELS
  }
}

export const routeOf = (model: string): EGenerateRoute =>
  model.startsWith('google/') ? EGenerateRoute.Text : EGenerateRoute.Image

export const isZeroDataRetention = (reason: string): boolean => {
  const text = reason.toLowerCase()
  return ZDR_MARKERS.some((marker) => text.includes(marker))
}

const textOfFailure = (failure: unknown): string => {
  if (!(failure instanceof Error)) return String(failure)

  const body =
    'responseBody' in failure && typeof failure.responseBody === 'string'
      ? failure.responseBody
      : ''
  return [failure.message, body].filter((part) => part.length > 0).join(' ')
}

const firstPictureOf = (pictures: readonly SdkPicture[]): GenerateImageInput | undefined => {
  const picture = pictures.find((entry) => entry.mediaType.startsWith('image/'))
  return picture === undefined
    ? undefined
    : { bytes: picture.uint8Array, mediaType: picture.mediaType }
}

const messagesOf = (args: {
  prompt: string
  images: readonly GenerateImageInput[]
}): ModelMessage[] => [
  {
    role: 'user',
    content: [
      ...args.images.map((image) => ({
        type: 'file' as const,
        data: image.bytes,
        mediaType: image.mediaType,
      })),
      { type: 'text' as const, text: args.prompt },
    ],
  },
]

const promptOf = (args: {
  prompt: string
  images: readonly GenerateImageInput[]
}): string | { images: Uint8Array[]; text: string } =>
  args.images.length === 0
    ? args.prompt
    : { images: args.images.map((image) => image.bytes), text: args.prompt }

export async function generateWithGateway(args: {
  apiKey: string
  model: string
  prompt: string
  images: readonly GenerateImageInput[]
  signal: AbortSignal
  sdk?: GenerateSdk | undefined
}): Promise<GenerateOutcome> {
  const sdk = args.sdk ?? DEFAULT_SDK
  const gateway = createGateway({ apiKey: args.apiKey })

  try {
    const picture =
      routeOf(args.model) === EGenerateRoute.Text
        ? firstPictureOf(
            (
              await sdk.text({
                model: gateway(args.model),
                messages: messagesOf({ prompt: args.prompt, images: args.images }),
                abortSignal: args.signal,
              })
            ).files,
          )
        : firstPictureOf(
            (
              await sdk.image({
                model: gateway.imageModel(args.model),
                prompt: promptOf({ prompt: args.prompt, images: args.images }),
                abortSignal: args.signal,
              })
            ).images,
          )

    if (picture === undefined) {
      return {
        ok: false,
        refusal: EGenerateRefusal.Failed,
        reason: `${args.model} returned no image.`,
      }
    }

    return { ok: true, bytes: picture.bytes, mediaType: picture.mediaType }
  } catch (failure) {
    const reason = textOfFailure(failure)
    return {
      ok: false,
      refusal: isZeroDataRetention(reason)
        ? EGenerateRefusal.ZeroDataRetention
        : EGenerateRefusal.Failed,
      reason,
    }
  }
}
