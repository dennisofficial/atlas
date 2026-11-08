import {
  MAX_API_EDGE,
  MAX_INLINE_BYTES,
  OPENAI_COMPLETIONS_API,
  type ImageCapabilities,
  type ModelCard,
} from '@dltech/atlas-core'

const MEGABYTE = 1024 * 1024

const INLINE_ONLY: ImageCapabilities = { images: 'inline', maxInlineBytes: MAX_INLINE_BYTES }

const BY_API: Readonly<Record<string, ImageCapabilities>> = {
  'anthropic-messages': { images: 'both', maxInlineBytes: MAX_INLINE_BYTES, maxEdge: MAX_API_EDGE },
  'openai-responses': { images: 'both', maxInlineBytes: 20 * MEGABYTE },
  [OPENAI_COMPLETIONS_API]: INLINE_ONLY,
  'ai-gateway': INLINE_ONLY,
}

const TEXT_ONLY_MODEL_IDS: readonly RegExp[] = [
  /(?:^|\/)deepseek-(?:chat|r1|v3)/,
  /(?:^|\/)llama-3\.[13]-/,
  /(?:^|\/)codestral/,
  /(?:^|\/)devstral/,
]

const hasNoVision = (modelId: string): boolean =>
  TEXT_ONLY_MODEL_IDS.some((pattern) => pattern.test(modelId))

export function imageCapabilitiesOf(args: {
  api: string
  ref: ModelCard['ref']
}): ImageCapabilities {
  const byApi = BY_API[args.api] ?? INLINE_ONLY
  if (args.api !== OPENAI_COMPLETIONS_API) return byApi
  return hasNoVision(args.ref.modelId) ? { ...byApi, images: 'none' } : byApi
}
