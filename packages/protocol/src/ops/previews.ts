import { z } from 'zod'

import { okResultSchema } from './result'

export const previewsEnsureOpSchema = z
  .object({
    op: z.literal('previews.ensure'),
    tunnelToken: z.string().min(1).optional(),
  })
  .strict()

export const previewsStatusOpSchema = z.object({ op: z.literal('previews.status') }).strict()

export const previewTunnelStateSchema = z.enum(['stopped', 'starting', 'up', 'failed'])

export const previewTunnelStatusSchema = z
  .object({
    state: previewTunnelStateSchema,
    pid: z.number().int().min(1).optional(),
    restarts: z.number().int().min(0),
    upAt: z.string().min(1).optional(),
    lastError: z.string().optional(),
    tail: z.string(),
  })
  .strict()

export const previewsOpSchemas = [previewsEnsureOpSchema, previewsStatusOpSchema] as const

export const previewsResultSchemas = [
  okResultSchema({ op: 'previews.ensure', value: previewTunnelStatusSchema }),
  okResultSchema({ op: 'previews.status', value: previewTunnelStatusSchema }),
] as const

export const previewsReadyEventSchema = z
  .object({ type: z.literal('previews.ready'), at: z.string().min(1) })
  .strict()

export const previewsEventSchemas = [previewsReadyEventSchema] as const

export type PreviewsEnsureOp = z.infer<typeof previewsEnsureOpSchema>
export type PreviewsStatusOp = z.infer<typeof previewsStatusOpSchema>
export type PreviewTunnelState = z.infer<typeof previewTunnelStateSchema>
export type PreviewTunnelStatus = z.infer<typeof previewTunnelStatusSchema>
export type PreviewsReadyEvent = z.infer<typeof previewsReadyEventSchema>
