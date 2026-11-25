import type { JsonValue } from '../json/value'
import type { MediaRef } from '../media/media-ref'
import type { ProviderOptions } from '../provider'

export type TextPart = { type: 'text'; text: string; providerOptions?: ProviderOptions | undefined }

export type ReasoningPart = {
  type: 'reasoning'
  text: string
  providerOptions?: ProviderOptions | undefined
}

export type ImageBytes = { kind: 'inline'; data: string } | { kind: 'url'; url: string }

export type ImagePart = {
  type: 'image'
  bytes: ImageBytes
  mediaType: string
  source?: string | undefined
  width?: number | undefined
  height?: number | undefined
  providerOptions?: ProviderOptions | undefined
}

export type FilePart = {
  type: 'file'
  data: string
  mediaType: string
  filename?: string | undefined
  source?: string | undefined
  providerOptions?: ProviderOptions | undefined
}

export type MediaPart = {
  type: 'media'
  media: MediaRef
  source?: string | undefined
  providerOptions?: ProviderOptions | undefined
}

export type UserContentPart = TextPart | ImagePart | FilePart | MediaPart

export type ToolCallPart = {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  input: unknown
  providerOptions?: ProviderOptions | undefined
}

export type ToolResultOutput =
  | { type: 'text'; value: string }
  | { type: 'json'; value: JsonValue }
  | { type: 'error-text'; value: string }
  | { type: 'error-json'; value: JsonValue }
  | { type: 'content'; value: readonly UserContentPart[] }

export type ToolResultPart = {
  type: 'tool-result'
  toolCallId: string
  toolName: string
  output: ToolResultOutput
  providerOptions?: ProviderOptions | undefined
}

export type MessagePart =
  | TextPart
  | ImagePart
  | FilePart
  | MediaPart
  | ReasoningPart
  | ToolCallPart
  | ToolResultPart
