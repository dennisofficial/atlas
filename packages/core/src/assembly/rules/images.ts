import {
  decodeBase64,
  decodesAsImage,
  imageSize,
  SUPPORTED_IMAGE_MEDIA_TYPES,
  type SupportedImageMediaType,
} from '../../images/limits'
import type { Message } from '../../message/message'
import type { FilePart, ImagePart, TextPart, ToolResultPart } from '../../message/parts'
import type { AssembledMessage } from '../assembled'
import { defineRule, type Rule } from '../rule'

/**
 * Past twenty image blocks in one request the API applies a stricter per-image dimension limit to
 * every image in that request, the ones already sent included, and tool-result images count toward
 * the threshold. Retiring the oldest keeps the newest screenshot at full fidelity rather than
 * letting the twenty-first quietly degrade the other twenty.
 * https://platform.claude.com/docs/en/build-with-claude/vision
 */
export const MAX_IMAGE_BLOCKS = 20

type VisualPart = TextPart | ImagePart | FilePart

const describedSize = (part: ImagePart): string => {
  const size =
    part.width === undefined || part.height === undefined
      ? imageSize({ bytes: decodeBase64(part.data), mediaType: part.mediaType })
      : { width: part.width, height: part.height }
  if (size === null) return part.mediaType

  return `${part.mediaType} ${size.width}×${size.height}`
}

const described = (part: ImagePart): string =>
  part.source === undefined ? describedSize(part) : `${part.source} · ${describedSize(part)}`

const describedFile = (part: FilePart): string => {
  const name = part.filename ?? part.source ?? part.mediaType
  return part.source === undefined || part.filename !== undefined
    ? name
    : `${part.source} · ${part.mediaType}`
}

const withoutPixels = (part: ImagePart | FilePart): TextPart => ({
  type: 'text',
  text:
    part.type === 'image'
      ? `[image dropped from context: ${described(part)}]`
      : `[file dropped from context: ${describedFile(part)}]`,
})

const withoutCorruptPixels = (part: ImagePart): TextPart => ({
  type: 'text',
  text: `[image dropped from context: ${described(part)} · not a valid image of its type]`,
})

const asSupported = (mediaType: string): SupportedImageMediaType | null =>
  (SUPPORTED_IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType)
    ? (mediaType as SupportedImageMediaType)
    : null

const imageIsCorrupt = (part: ImagePart): boolean => {
  const mediaType = asSupported(part.mediaType)
  if (mediaType === null) return false
  return !decodesAsImage({ bytes: decodeBase64(part.data), mediaType })
}

const imagesInParts = (parts: readonly VisualPart[]): number =>
  parts.reduce((count, part) => count + (part.type === 'image' || part.type === 'file' ? 1 : 0), 0)

const imagesInResult = (part: ToolResultPart): number =>
  part.output.type === 'content' ? imagesInParts(part.output.value) : 0

function imagesInMessage(message: Message): number {
  if (message.role === 'user') return imagesInParts(message.content)
  if (message.role === 'tool') {
    return message.content.reduce((count, part) => count + imagesInResult(part), 0)
  }
  return 0
}

type Downgrades = { claim: () => boolean }

const downgrades = (allowance: number): Downgrades => {
  let claimed = 0
  return {
    claim: () => {
      if (claimed >= allowance) return false
      claimed += 1
      return true
    },
  }
}

const downgradedParts = ({
  parts,
  budget,
}: {
  parts: readonly VisualPart[]
  budget: Downgrades
}): readonly VisualPart[] =>
  parts.map((part) =>
    (part.type === 'image' || part.type === 'file') && budget.claim() ? withoutPixels(part) : part,
  )

function downgradedResult({
  part,
  budget,
}: {
  part: ToolResultPart
  budget: Downgrades
}): ToolResultPart {
  if (part.output.type !== 'content') return part
  if (imagesInParts(part.output.value) === 0) return part

  return {
    ...part,
    output: { type: 'content', value: downgradedParts({ parts: part.output.value, budget }) },
  }
}

function downgradedMessage({ message, budget }: { message: Message; budget: Downgrades }): Message {
  if (message.role === 'user') {
    return { ...message, content: downgradedParts({ parts: message.content, budget }) }
  }
  if (message.role === 'tool') {
    return {
      ...message,
      content: message.content.map((part) => downgradedResult({ part, budget })),
    }
  }
  return message
}

function downgradedEntry({
  entry,
  budget,
}: {
  entry: AssembledMessage
  budget: Downgrades
}): AssembledMessage {
  if (imagesInMessage(entry.message) === 0) return entry
  return { ...entry, message: downgradedMessage({ message: entry.message, budget }) }
}

export function imagesInContext({
  limit = MAX_IMAGE_BLOCKS,
}: { limit?: number | undefined } = {}): Rule {
  return defineRule({
    name: 'imagesInContext',
    apply: (input) => {
      const total = input.messages.reduce(
        (count, entry) => count + imagesInMessage(entry.message),
        0,
      )

      const allowance = total - Math.max(0, limit)
      if (allowance <= 0) return input

      const budget = downgrades(allowance)

      return {
        system: input.system,
        messages: input.messages.map((entry) => downgradedEntry({ entry, budget })),
      }
    },
  })
}

const corruptedParts = ({ parts }: { parts: readonly VisualPart[] }): readonly VisualPart[] | null => {
  const mapped = parts.map((part) => (part.type === 'image' && imageIsCorrupt(part) ? withoutCorruptPixels(part) : part))
  return mapped.every((part, index) => part === parts[index]) ? null : mapped
}

function corruptedResult({ part }: { part: ToolResultPart }): ToolResultPart {
  if (part.output.type !== 'content') return part
  const value = corruptedParts({ parts: part.output.value })
  if (value === null) return part
  return { ...part, output: { type: 'content', value } }
}

function corruptedMessage({ message }: { message: Message }): Message | null {
  if (message.role === 'user') {
    const content = corruptedParts({ parts: message.content })
    return content === null ? null : { ...message, content }
  }
  if (message.role === 'tool') {
    const content = message.content.map((part) => corruptedResult({ part }))
    return content.every((part, index) => part === message.content[index]) ? null : { ...message, content }
  }
  return null
}

/**
 * A corrupt image part poisons the whole history: every later turn re-sends it, and a provider
 * whose decoder is stricter than ours rejects the request, so the session fails on every message
 * after the read. Replacing the part with a description at assembly time keeps the event log
 * untouched and lets the next turn through, which heals a session the corrupt image already
 * bricked. readImage refuses to inline such a file in the first place, so this rule is the
 * backstop for sessions written before that refusal existed.
 */
export function corruptImagesDropped(): Rule {
  return defineRule({
    name: 'corruptImagesDropped',
    apply: (input) => {
      const messages = input.messages.map((entry) => {
        if (imagesInMessage(entry.message) === 0) return entry
        const message = corruptedMessage({ message: entry.message })
        return message === null ? entry : { ...entry, message }
      })
      if (messages.every((entry, index) => entry === input.messages[index])) return input
      return { system: input.system, messages }
    },
  })
}
