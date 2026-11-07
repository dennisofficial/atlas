import { z } from 'zod'

import { streamClientMessageSchema, type StreamClientMessage } from './stream-client'
import { streamServerMessageSchema, type StreamServerMessage } from './stream-server'

export * from './stream-constants'
export * from './stream-client'
export * from './stream-server'

export type StreamParseResult<T> =
  | { ok: true; message: T }
  | { ok: false; unknown: true }
  | { ok: false; issue: z.ZodError }

const typeOf = (raw: unknown): string | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const { type } = raw as { type?: unknown }
  return typeof type === 'string' ? type : undefined
}

const typesOf = (option: z.core.$ZodType): string[] => {
  if (option instanceof z.ZodDiscriminatedUnion) return option.options.flatMap(typesOf)
  if (!(option instanceof z.ZodObject)) return []
  const { type } = option.shape
  return type instanceof z.ZodLiteral ? [String(type.value)] : []
}

const knownTypesOf = (options: readonly z.core.$ZodType[]): Set<string> =>
  new Set(options.flatMap(typesOf))

const parseMessage = <T>(params: {
  raw: unknown
  schema: z.ZodType<T>
  known: ReadonlySet<string>
}): StreamParseResult<T> => {
  const { raw, schema, known } = params
  const type = typeOf(raw)
  if (type !== undefined && !known.has(type)) return { ok: false, unknown: true }
  const parsed = schema.safeParse(raw)
  if (parsed.success) return { ok: true, message: parsed.data }
  return { ok: false, issue: parsed.error }
}

const KNOWN_SERVER_TYPES = knownTypesOf(streamServerMessageSchema.options)

const KNOWN_CLIENT_TYPES = new Set(['hello', 'subscribe', 'unsubscribe', 'resnap', 'ping'])

export const parseServerMessage = (raw: unknown): StreamParseResult<StreamServerMessage> =>
  parseMessage({ raw, schema: streamServerMessageSchema, known: KNOWN_SERVER_TYPES })

export const parseClientMessage = (raw: unknown): StreamParseResult<StreamClientMessage> =>
  parseMessage({ raw, schema: streamClientMessageSchema, known: KNOWN_CLIENT_TYPES })
