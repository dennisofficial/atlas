import { decodeBase64, imageSize, visualTokens, type ImageSize } from '../images/limits'
import { DEFAULT_IMAGE_TIER, patchTokens, type EImageTier } from '../images/projection'
import type { Message } from '../message/message'
import type { FilePart, ImagePart, MessagePart } from '../message/parts'
import type { Assembled } from './assembled'

const CHARS_PER_TOKEN = 4

export enum EImagePricing {
  /** Images cost the tier-projected clamp, as Anthropic's API bills them. */
  TierProjection = 'tier-projection',
  /** Images cost patches of their actual dimensions, as SGLang bills them with no clamp. */
  ActualPatches = 'actual-patches',
}

const UNMEASURABLE_IMAGE_TOKENS = 1600

const textTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN)

/**
 * Decoding megabytes of base64 to re-read a header costs more than the count is worth, and every
 * part built from an event or a tool result already carries what the header would have said.
 */
const measured = (part: ImagePart): ImageSize | null =>
  part.width === undefined || part.height === undefined
    ? imageSize({ bytes: decodeBase64(part.data), mediaType: part.mediaType })
    : { width: part.width, height: part.height }

function imageTokens({ part, cost }: { part: ImagePart; cost: ImageCost }): number {
  const size = measured(part)
  if (!size) return UNMEASURABLE_IMAGE_TOKENS
  if (cost.pricing === EImagePricing.ActualPatches) return patchTokens(size)

  return visualTokens({ byteLength: 0, tier: cost.tier, ...size }) ?? UNMEASURABLE_IMAGE_TOKENS
}

const fileTokens = (part: FilePart): number => textTokens(part.data)

function partTokens({ part, cost }: { part: MessagePart; cost: ImageCost }): number {
  if (part.type === 'text' || part.type === 'reasoning') return textTokens(part.text)
  if (part.type === 'image') return imageTokens({ part, cost })
  if (part.type === 'file') return fileTokens(part)
  if (part.type === 'tool-call') return textTokens(JSON.stringify(part.input ?? null))
  if (part.output.type === 'content') {
    return part.output.value.reduce(
      (total: number, inner: MessagePart) => total + partTokens({ part: inner, cost }),
      0,
    )
  }
  return textTokens(JSON.stringify(part.output))
}

export type ImageCost = {
  tier: EImageTier
  pricing?: EImagePricing | undefined
}

export const DEFAULT_IMAGE_COST: ImageCost = {
  tier: DEFAULT_IMAGE_TIER,
  pricing: EImagePricing.TierProjection,
}

export function estimateMessageTokens(message: Message, cost: ImageCost = DEFAULT_IMAGE_COST): number {
  const parts: readonly MessagePart[] = message.content
  return parts.reduce((total, part) => total + partTokens({ part, cost }), 0)
}

/**
 * A picture's cost depends on which resolution tier the model reads at, so the estimator is bound to
 * a model before it is handed to the loop rather than assuming one.
 */
export const estimateTokensFor =
  (cost: ImageCost) =>
  (assembled: Assembled): number => {
    const systemTokens = assembled.system.reduce((total, block) => total + textTokens(block.text), 0)
    return assembled.messages.reduce(
      (total, assembledMessage) => total + estimateMessageTokens(assembledMessage.message, cost),
      systemTokens,
    )
  }

export const estimateTokens = estimateTokensFor(DEFAULT_IMAGE_COST)
