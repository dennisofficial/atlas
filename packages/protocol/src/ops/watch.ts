import { z } from 'zod'

import { okResultSchema } from './result'

const MAX_DEBOUNCE_MS = 5_000

const watchIdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_.:-]+$/)

export const watchStartOpSchema = z
  .object({
    op: z.literal('watch.start'),
    watchId: watchIdSchema,
    roots: z.array(z.string().min(1)).min(1).max(16),
    debounceMs: z.number().int().min(0).max(MAX_DEBOUNCE_MS).optional(),
  })
  .strict()

export const watchStopOpSchema = z
  .object({ op: z.literal('watch.stop'), watchId: watchIdSchema })
  .strict()

export const watchOpSchemas = [watchStartOpSchema, watchStopOpSchema] as const

export const watchResultSchemas = [
  okResultSchema({ op: 'watch.start', value: z.array(z.string()) }),
  okResultSchema({ op: 'watch.stop', value: z.null() }),
] as const

export const watchChangedEventSchema = z
  .object({
    type: z.literal('watch.changed'),
    watchId: watchIdSchema,
    paths: z.array(z.string()).min(1),
  })
  .strict()

export const watchEventSchemas = [watchChangedEventSchema] as const

export type WatchStartOp = z.infer<typeof watchStartOpSchema>
export type WatchStopOp = z.infer<typeof watchStopOpSchema>
export type WatchChangedEvent = z.infer<typeof watchChangedEventSchema>
