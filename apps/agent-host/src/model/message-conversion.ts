import type { AssistantContent, ModelMessage, ToolResultPart as ModelToolResultPart } from 'ai'

import {
  imagePathLine,
  type AssistantMessage,
  type FilePart,
  type ImagePart,
  type MediaPart,
  type Message,
  type ReasoningPart,
  type TextPart,
  type ToolCallPart,
  type ToolResultOutput,
  type ToolResultPart,
  type UserContentPart,
} from '@dltech/atlas-core'

import { carriedProviderOptions } from './provider-options'
import { sanitizeToolCallIds } from './tool-call-ids'

export { fromModelMessage, fromModelMessages } from './from-model-message'

type ModelAssistantPart = Extract<AssistantContent, readonly unknown[]>[number]
type ModelToolResultOutput = ModelToolResultPart['output']
type CoreAssistantPart = AssistantMessage['content'][number]

const toModelTextPart = (part: TextPart) => ({
  type: 'text' as const,
  text: part.text,
  ...carriedProviderOptions(part.providerOptions),
})

const toModelReasoningPart = (part: ReasoningPart) => ({
  type: 'reasoning' as const,
  text: part.text,
  ...carriedProviderOptions(part.providerOptions),
})

const toModelToolCallPart = (part: ToolCallPart) => ({
  type: 'tool-call' as const,
  toolCallId: part.toolCallId,
  toolName: part.toolName,
  input: part.input,
  ...carriedProviderOptions(part.providerOptions),
})

export type MediaUrls = ReadonlyMap<string, string>

export type MissingMedia = ReadonlySet<string>

type MediaSend = { mediaUrls: MediaUrls; missingMedia: MissingMedia }

const NO_MEDIA_URLS: MediaUrls = new Map()

const NO_MISSING_MEDIA: MissingMedia = new Set()

const toModelMediaText = (part: MediaPart) => ({
  type: 'text' as const,
  text: imagePathLine({
    path: part.source ?? part.media.hash,
    width: part.media.width,
    height: part.media.height,
  }),
})

const toModelMediaUrlPart = ({ part, url }: { part: MediaPart; url: string }) => ({
  type: 'file' as const,
  data: { type: 'url' as const, url: new URL(url) },
  mediaType: part.media.mediaType,
})

const toModelMissingMediaText = (part: MediaPart) => ({
  type: 'text' as const,
  text: `[image unavailable: ${part.source ?? part.media.hash}]`,
})

const toModelMediaPart = ({ part, media }: { part: MediaPart; media: MediaSend }) => {
  if (media.missingMedia.has(part.media.hash)) return toModelMissingMediaText(part)
  const url = media.mediaUrls.get(part.media.hash)
  return url === undefined ? toModelMediaText(part) : toModelMediaUrlPart({ part, url })
}

const toModelToolResultOutput = ({
  output,
  media,
}: {
  output: ToolResultOutput
  media: MediaSend
}): ModelToolResultOutput => {
  if (output.type !== 'content') return output

  return {
    type: 'content',
    value: output.value.map((part) =>
      part.type === 'text'
        ? { type: 'text' as const, text: part.text }
        : part.type === 'media'
          ? toModelMediaPart({ part, media })
          : part.type === 'image'
            ? toModelResultImagePart(part)
            : {
                type: 'file' as const,
                data: { type: 'data' as const, data: part.data },
                mediaType: part.mediaType,
                ...(part.type === 'file' && part.filename !== undefined
                  ? { filename: part.filename }
                  : {}),
              },
    ),
  }
}

const toModelToolResultPart = ({ part, media }: { part: ToolResultPart; media: MediaSend }) => ({
  type: 'tool-result' as const,
  toolCallId: part.toolCallId,
  toolName: part.toolName,
  output: toModelToolResultOutput({ output: part.output, media }),
  ...carriedProviderOptions(part.providerOptions),
})

const toModelImagePart = (part: ImagePart) =>
  part.bytes.kind === 'url'
    ? {
        type: 'image' as const,
        image: new URL(part.bytes.url),
        mediaType: part.mediaType,
        ...carriedProviderOptions(part.providerOptions),
      }
    : {
        type: 'file' as const,
        data: { type: 'data' as const, data: part.bytes.data },
        mediaType: part.mediaType,
        ...carriedProviderOptions(part.providerOptions),
      }

const toModelResultImagePart = (part: ImagePart) =>
  part.bytes.kind === 'url'
    ? {
        type: 'file' as const,
        data: { type: 'url' as const, url: new URL(part.bytes.url) },
        mediaType: part.mediaType,
      }
    : {
        type: 'file' as const,
        data: { type: 'data' as const, data: part.bytes.data },
        mediaType: part.mediaType,
      }

const toModelFilePart = (part: FilePart) => ({
  type: 'file' as const,
  data: { type: 'data' as const, data: part.data },
  mediaType: part.mediaType,
  ...(part.filename === undefined ? {} : { filename: part.filename }),
  ...carriedProviderOptions(part.providerOptions),
})

const toModelUserPart = ({ part, media }: { part: UserContentPart; media: MediaSend }) => {
  if (part.type === 'media') {
    const converted = toModelMediaPart({ part, media })
    if (converted.type === 'text') return converted
    return { ...converted, ...carriedProviderOptions(part.providerOptions) }
  }
  if (part.type === 'image') return toModelImagePart(part)
  if (part.type === 'file') return toModelFilePart(part)
  return toModelTextPart(part)
}

const toModelAssistantPart = (part: CoreAssistantPart): ModelAssistantPart => {
  if (part.type === 'text') return toModelTextPart(part)
  if (part.type === 'reasoning') return toModelReasoningPart(part)
  return toModelToolCallPart(part)
}

export type MediaSendOptions = { mediaUrls?: MediaUrls; missingMedia?: MissingMedia }

const mediaSendOf = (options: MediaSendOptions): MediaSend => ({
  mediaUrls: options.mediaUrls ?? NO_MEDIA_URLS,
  missingMedia: options.missingMedia ?? NO_MISSING_MEDIA,
})

export function toModelMessage(message: Message, options: MediaSendOptions = {}): ModelMessage {
  const media = mediaSendOf(options)
  if (message.role === 'user') {
    return {
      role: 'user',
      content: message.content.map((part) => toModelUserPart({ part, media })),
      ...carriedProviderOptions(message.providerOptions),
    }
  }

  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: message.content.map((part) => toModelToolResultPart({ part, media })),
      ...carriedProviderOptions(message.providerOptions),
    }
  }

  return {
    role: 'assistant',
    content: message.content.map(toModelAssistantPart),
    ...carriedProviderOptions(message.providerOptions),
  }
}

export const toModelMessages = (
  messages: readonly Message[],
  options: MediaSendOptions = {},
): ModelMessage[] =>
  sanitizeToolCallIds(messages.map((message) => toModelMessage(message, options)))
