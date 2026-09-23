import type { EImageTier } from '../images/projection'
import type { EffortMap } from './effort-ladder'
import { refKey, type ModelRef } from './ref'

export type ModelCost = {
  inputPerMillion: number
  outputPerMillion: number
  cacheReadPerMillion?: number
  cacheWritePerMillion?: number
}

export type ModelCard = {
  ref: ModelRef
  label: string
  api: string
  contextWindow: number
  imageTier: EImageTier
  maxOutputTokens?: number
  cost?: ModelCost
  effort?: EffortMap
}

export const OPENAI_COMPLETIONS_API = 'openai-completions'

/**
 * The chat-completions wire format has no image block in tool messages, so the AI SDK's
 * openai-compatible provider answers a tool-result image with `JSON.stringify(output.value)` —
 * the base64 lands in the prompt as plain text and is tokenized at roughly a token per byte.
 * The responses API emits a proper `input_image` and Anthropic carries tool-result images
 * natively, so only completions loses the picture.
 * https://github.com/vercel/ai/blob/main/packages/openai-compatible/src/chat/convert-to-openai-compatible-chat-messages.ts
 */
export const carriesToolResultImages = (card: Pick<ModelCard, 'api'> | undefined): boolean =>
  card === undefined ? true : card.api !== OPENAI_COMPLETIONS_API

export type ModelCatalog = ReadonlyMap<string, ModelCard>

export const catalogOf = (cards: readonly ModelCard[]): ModelCatalog =>
  new Map(cards.map((card) => [refKey(card.ref), card]))

export const findCard = (args: { catalog: ModelCatalog; ref: ModelRef }): ModelCard | undefined =>
  args.catalog.get(refKey(args.ref))
