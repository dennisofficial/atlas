import { decodeBase64, imageSize, visualTokens, type ImageSize } from '../images/limits'
import { DEFAULT_IMAGE_TIER, type EImageTier } from '../images/projection'
import type { Message } from '../message/message'
import type { ImagePart, MessagePart } from '../message/parts'
import type { Assembled } from './assembled'

const CHARS_PER_TOKEN = 4

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

function imageTokens({ part, tier }: { part: ImagePart; tier: EImageTier }): number {
  const size = measured(part)
  if (!size) return UNMEASURABLE_IMAGE_TOKENS

  return visualTokens({ byteLength: 0, tier, ...size }) ?? UNMEASURABLE_IMAGE_TOKENS
}

/**
 * A model whose API stringifies tool results (openai-completions) receives a tool-result image as
 * base64 text, so it is counted as text; an image the user pasted still travels as a real image
 * and keeps its visual count.
 */
function partTokens(args: {
  part: MessagePart
  tier: EImageTier
  toolImagesAsText: boolean
}): number {
  const { part, tier } = args
  if (part.type === 'text' || part.type === 'reasoning') return textTokens(part.text)
  if (part.type === 'image') {
    return args.toolImagesAsText ? textTokens(part.data) : imageTokens({ part, tier })
  }
  if (part.type === 'tool-call') return textTokens(JSON.stringify(part.input ?? null))
  if (part.output.type === 'content') {
    return part.output.value.reduce(
      (total, inner) => total + partTokens({ part: inner, tier, toolImagesAsText: args.toolImagesAsText }),
      0,
    )
  }
  return textTokens(JSON.stringify(part.output))
}

export function estimateMessageTokens(args: {
  message: Message
  tier?: EImageTier
  carriesToolImages?: boolean
}): number {
  const tier = args.tier ?? DEFAULT_IMAGE_TIER
  const toolImagesAsText = args.message.role === 'tool' && args.carriesToolImages === false
  const parts: readonly MessagePart[] = args.message.content
  return parts.reduce((total, part) => total + partTokens({ part, tier, toolImagesAsText }), 0)
}

/**
 * A picture's cost depends on which resolution tier the model reads at and whether its API can
 * carry tool-result images at all, so the estimator is bound to a model before it is handed to
 * the loop rather than assuming one.
 */
export const estimateTokensFor =
  (args: { tier: EImageTier; carriesToolImages?: boolean }) =>
  (assembled: Assembled): number => {
    const systemTokens = assembled.system.reduce((total, block) => total + textTokens(block.text), 0)
    return assembled.messages.reduce(
      (total, assembledMessage) =>
        total +
        estimateMessageTokens({
          message: assembledMessage.message,
          tier: args.tier,
          ...(args.carriesToolImages === undefined ? {} : { carriesToolImages: args.carriesToolImages }),
        }),
      systemTokens,
    )
  }

export const estimateTokens = estimateTokensFor({ tier: DEFAULT_IMAGE_TIER })
