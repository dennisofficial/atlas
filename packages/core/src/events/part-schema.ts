import { z } from 'zod'

import { mediaRefSchema } from '../media/media-ref'
import type { ProviderOptions } from '../provider'
import { MAX_UPLOAD_BYTES } from '../uploads/limits'

const providerOptionsSchema = z.custom<ProviderOptions>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
)

export const stepUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
  contextWindow: z.number().int().positive().optional(),
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
})

export const assistantPartSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
    providerOptions: providerOptionsSchema.optional(),
  }),
  z.object({
    type: z.literal('reasoning'),
    text: z.string(),
    providerOptions: providerOptionsSchema.optional(),
  }),
])

const imageBytesSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inline'), data: z.string() }),
  z.object({ kind: z.literal('url'), url: z.string() }),
])

const imagePartSchema = z.object({
  type: z.literal('image'),
  bytes: imageBytesSchema,
  mediaType: z.string(),
  source: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  providerOptions: providerOptionsSchema.optional(),
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function withCurrentImageShape(part: unknown): unknown {
  if (!isRecord(part) || part['type'] !== 'image') return part
  if (typeof part['data'] !== 'string' || 'bytes' in part) return part
  const { data, ...rest } = part
  return { ...rest, bytes: { kind: 'inline', data } }
}

const toolResultPartUnion = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
    providerOptions: providerOptionsSchema.optional(),
  }),
  imagePartSchema,
  z.object({
    type: z.literal('file'),
    data: z.string(),
    mediaType: z.string(),
    filename: z.string().optional(),
    source: z.string().optional(),
    providerOptions: providerOptionsSchema.optional(),
  }),
  z.object({
    type: z.literal('media'),
    media: mediaRefSchema,
    source: z.string().optional(),
    providerOptions: providerOptionsSchema.optional(),
  }),
])

export const toolResultPartSchema = z.preprocess(withCurrentImageShape, toolResultPartUnion)

export const saidImageSchema = z.object({
  path: z.string(),
  mediaType: z.string(),
  data: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export const saidMediaSchema = z.object({
  media: mediaRefSchema,
  source: z.string().optional(),
})

export const saidFileSchema = z.object({
  path: z.string(),
  mediaType: z.string(),
  data: z.string(),
  filename: z.string().optional(),
})

export const saidUploadSchema = z.object({
  uploadId: z.uuid(),
  pathname: z.string().max(500),
  name: z.string().min(1).max(200),
  size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
  mediaType: z.string().max(200),
})
