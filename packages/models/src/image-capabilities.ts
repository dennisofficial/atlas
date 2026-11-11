import {
  MAX_API_EDGE,
  MAX_INLINE_BYTES,
  OPENAI_COMPLETIONS_API,
  type ImageCapabilities,
} from '@dltech/atlas-core'

const MEGABYTE = 1024 * 1024

const INLINE_ONLY: ImageCapabilities = { images: 'inline', maxInlineBytes: MAX_INLINE_BYTES }

const BY_API: Readonly<Record<string, ImageCapabilities>> = {
  'anthropic-messages': { images: 'both', maxInlineBytes: MAX_INLINE_BYTES, maxEdge: MAX_API_EDGE },
  'openai-responses': { images: 'both', maxInlineBytes: 20 * MEGABYTE },
  [OPENAI_COMPLETIONS_API]: INLINE_ONLY,
  'ai-gateway': INLINE_ONLY,
}

const IMAGE_MODALITY = 'image'

export function imageCapabilitiesOf(args: {
  api: string
  inputModalities?: readonly string[] | undefined
}): ImageCapabilities {
  const byApi = BY_API[args.api] ?? INLINE_ONLY
  const seesImages = args.inputModalities?.includes(IMAGE_MODALITY)

  return seesImages === false ? { ...byApi, images: 'none' } : byApi
}
