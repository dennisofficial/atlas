import type {
  AssistantContent,
  ModelMessage,
  ToolResultPart as ModelToolResultPart,
  UserContent,
} from 'ai'

import type {
  AssistantMessage,
  FilePart,
  ImagePart,
  Message,
  ReasoningPart,
  TextPart,
  ToolCallPart,
  ToolMessage,
  ToolResultOutput,
  ToolResultPart,
  UserMessage,
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

const toModelToolResultOutput = (output: ToolResultOutput): ModelToolResultOutput => {
  if (output.type !== 'content') return output

  return {
    type: 'content',
    value: output.value.map((part) =>
      part.type === 'text'
        ? { type: 'text' as const, text: part.text }
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

const toModelToolResultPart = (part: ToolResultPart) => ({
  type: 'tool-result' as const,
  toolCallId: part.toolCallId,
  toolName: part.toolName,
  output: toModelToolResultOutput(part.output),
  ...carriedProviderOptions(part.providerOptions),
})

const toModelImagePart = (part: ImagePart) => ({
  type: 'file' as const,
  data: { type: 'data' as const, data: part.data },
  mediaType: part.mediaType,
  ...carriedProviderOptions(part.providerOptions),
})

const toModelFilePart = (part: FilePart) => ({
  type: 'file' as const,
  data: { type: 'data' as const, data: part.data },
  mediaType: part.mediaType,
  ...(part.filename === undefined ? {} : { filename: part.filename }),
  ...carriedProviderOptions(part.providerOptions),
})

const toModelUserPart = (part: TextPart | ImagePart | FilePart) => {
  if (part.type === 'image') return toModelImagePart(part)
  if (part.type === 'file') return toModelFilePart(part)
  return toModelTextPart(part)
}

const toModelAssistantPart = (part: CoreAssistantPart): ModelAssistantPart => {
  if (part.type === 'text') return toModelTextPart(part)
  if (part.type === 'reasoning') return toModelReasoningPart(part)
  return toModelToolCallPart(part)
}

export function toModelMessage(message: Message): ModelMessage {
  if (message.role === 'user') {
    return {
      role: 'user',
      content: message.content.map(toModelUserPart),
      ...carriedProviderOptions(message.providerOptions),
    }
  }

  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: message.content.map(toModelToolResultPart),
      ...carriedProviderOptions(message.providerOptions),
    }
  }

  return {
    role: 'assistant',
    content: message.content.map(toModelAssistantPart),
    ...carriedProviderOptions(message.providerOptions),
  }
}

export const toModelMessages = (messages: readonly Message[]): ModelMessage[] =>
  sanitizeToolCallIds(messages.map(toModelMessage))
