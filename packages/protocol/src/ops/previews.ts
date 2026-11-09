import { z } from 'zod'

import { okResultSchema } from './result'

const portSchema = z.number().int().min(1).max(65535)

export const previewsExposeOpSchema = z
  .object({
    op: z.literal('previews.expose'),
    port: portSchema,
    tunnelToken: z.string().min(1),
  })
  .strict()

export const previewsStopOpSchema = z
  .object({ op: z.literal('previews.stop'), port: portSchema })
  .strict()

export const previewsListOpSchema = z.object({ op: z.literal('previews.list') }).strict()

export const previewInfoSchema = z
  .object({ port: portSchema, pid: z.number().int().min(1) })
  .strict()

export const previewStopResultSchema = z.object({ stopped: z.boolean() }).strict()

export const previewsOpSchemas = [
  previewsExposeOpSchema,
  previewsStopOpSchema,
  previewsListOpSchema,
] as const

export const previewsResultSchemas = [
  okResultSchema({ op: 'previews.expose', value: previewInfoSchema }),
  okResultSchema({ op: 'previews.stop', value: previewStopResultSchema }),
  okResultSchema({ op: 'previews.list', value: z.array(previewInfoSchema) }),
] as const

export type PreviewsExposeOp = z.infer<typeof previewsExposeOpSchema>
export type PreviewsStopOp = z.infer<typeof previewsStopOpSchema>
export type PreviewsListOp = z.infer<typeof previewsListOpSchema>
export type PreviewInfo = z.infer<typeof previewInfoSchema>
export type PreviewStopResult = z.infer<typeof previewStopResultSchema>
