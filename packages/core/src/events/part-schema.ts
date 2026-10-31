import { z } from 'zod'

import type { ProviderOptions } from '../provider'
import { MAX_UPLOAD_BYTES } from '../uploads/limits'

const providerOptionsSchema = z.custom<ProviderOptions>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
)

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

export const toolResultPartSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
    providerOptions: providerOptionsSchema.optional(),
  }),
  z.object({
    type: z.literal('image'),
    data: z.string(),
    mediaType: z.string(),
    source: z.string().optional(),
    providerOptions: providerOptionsSchema.optional(),
  }),
  z.object({
    type: z.literal('file'),
    data: z.string(),
    mediaType: z.string(),
    filename: z.string().optional(),
    source: z.string().optional(),
    providerOptions: providerOptionsSchema.optional(),
  }),
])

export const saidImageSchema = z.object({
  path: z.string(),
  mediaType: z.string(),
  data: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
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
