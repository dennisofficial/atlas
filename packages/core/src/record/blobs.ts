import { z } from 'zod'

import { sha256Hex } from '../events/event-identity'
import { canonicalJson } from './canonical'
import type { V2Body } from './event'

export const BLOB_PREVIEW_BYTES = 2048

export type BlobRef = {
  $blob: { hash: string; size: number; preview: string }
}

export type BlobPayload = { hash: string; bytes: Uint8Array }

const blobRefSchema = z.object({
  $blob: z.object({
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.number().int().nonnegative(),
    preview: z.string(),
  }),
})

export const isBlobRef = (value: unknown): value is BlobRef =>
  blobRefSchema.safeParse(value).success

export type SpillableField = 'input' | 'output' | 'value'

export const spillableFieldOf = (body: V2Body): SpillableField | undefined => {
  if (body.type === 'tool-called') return 'input'
  if (body.type === 'tool-result') return 'output'
  if (body.type === 'fact-recorded') return 'value'
  return undefined
}

const fieldValue = (body: V2Body, field: SpillableField): unknown => {
  if (body.type === 'tool-called' && field === 'input') return body.input
  if (body.type === 'tool-result' && field === 'output') return body.output
  if (body.type === 'fact-recorded' && field === 'value') return body.value
  return undefined
}

const withField = <T extends V2Body>(body: T, field: SpillableField, value: unknown): T => {
  if (body.type === 'tool-called' && field === 'input') return { ...body, input: value } as T
  if (body.type === 'tool-result' && field === 'output') return { ...body, output: value } as T
  if (body.type === 'fact-recorded' && field === 'value') return { ...body, value } as T
  return body
}

const utf8Length = (codePoint: number): number => {
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  if (codePoint <= 0xffff) return 3
  return 4
}

const previewOf = (text: string): string => {
  let bytes = 0
  let end = 0
  for (const char of text) {
    bytes += utf8Length(char.codePointAt(0) ?? 0)
    if (bytes > BLOB_PREVIEW_BYTES) break
    end += char.length
  }
  return text.slice(0, end)
}

export function spillBody(args: { body: V2Body; thresholdBytes: number }): {
  body: V2Body
  blobs: BlobPayload[]
} {
  const field = spillableFieldOf(args.body)
  const value = field === undefined ? undefined : fieldValue(args.body, field)
  if (field === undefined || value === undefined) return { body: args.body, blobs: [] }
  const json = canonicalJson(value)
  const bytes = new TextEncoder().encode(json)
  if (bytes.byteLength <= args.thresholdBytes) return { body: args.body, blobs: [] }
  const hash = sha256Hex(bytes)
  const ref: BlobRef = { $blob: { hash, size: bytes.byteLength, preview: previewOf(json) } }
  return { body: withField(args.body, field, ref), blobs: [{ hash, bytes }] }
}

export type BlobRefOccurrence = { field: SpillableField; hash: string; size: number }

export const blobRefsOf = (event: V2Body): BlobRefOccurrence[] => {
  const field = spillableFieldOf(event)
  if (field === undefined) return []
  const value = fieldValue(event, field)
  if (!isBlobRef(value)) return []
  const { hash, size } = value.$blob
  return [{ field, hash, size }]
}

export function resolveBody<T extends V2Body>(args: {
  body: T
  values: ReadonlyMap<string, unknown>
}): T {
  const [ref] = blobRefsOf(args.body)
  if (ref === undefined) return args.body
  const value = args.values.get(ref.hash)
  if (value === undefined) throw new Error(`missing blob value for ${ref.hash}`)
  return withField(args.body, ref.field, value)
}

export const blobValueOf = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder().decode(bytes)) as unknown
