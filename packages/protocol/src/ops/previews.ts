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

export enum EPreviewRedialReason {
  Freeze = 'freeze',
  Gap = 'gap',
}

export const previewTunnelRedialSchema = z
  .object({
    id: z.string().min(1),
    reason: z.enum(EPreviewRedialReason),
    gapMs: z.number().min(0),
    skewMs: z.number(),
    stopMs: z.number().min(0),
    registerMs: z.number().min(0),
    ok: z.boolean(),
  })
  .strict()

export const previewsEventSchemas = [
  previewTunnelRedialSchema.extend({ type: z.literal('previews.redialed') }),
] as const

export const previewTunnelStatusSchema = z
  .object({
    state: previewTunnelStateSchema,
    pid: z.number().int().min(1).optional(),
    restarts: z.number().int().min(0),
    upAt: z.string().min(1).optional(),
    lastError: z.string().optional(),
    tail: z.string(),
    lastRedial: previewTunnelRedialSchema.optional(),
  })
  .strict()

export const previewsOpSchemas = [previewsEnsureOpSchema, previewsStatusOpSchema] as const

export const previewsResultSchemas = [
  okResultSchema({ op: 'previews.ensure', value: previewTunnelStatusSchema }),
  okResultSchema({ op: 'previews.status', value: previewTunnelStatusSchema }),
] as const

export type PreviewsEnsureOp = z.infer<typeof previewsEnsureOpSchema>
export type PreviewsStatusOp = z.infer<typeof previewsStatusOpSchema>
export type PreviewTunnelState = z.infer<typeof previewTunnelStateSchema>
export type PreviewTunnelRedial = z.infer<typeof previewTunnelRedialSchema>
export type PreviewTunnelStatus = z.infer<typeof previewTunnelStatusSchema>
