import { z } from 'zod'

import { threadIdWireSchema } from './request-wire'

export enum EWireRotationPhase {
  Settling = 'settling',
  Summarising = 'summarising',
  Compacting = 'compacting',
  Done = 'done',
  Failed = 'failed',
}

export const rotationStateWireSchema = z.object({
  phase: z.enum(EWireRotationPhase),
  watermarkSeq: z.number().int().nonnegative().optional(),
  reason: z.string().nullish(),
})
export type RotationStateWire = z.infer<typeof rotationStateWireSchema>

export const rotateRequestParamsSchema = z.object({
  threadId: threadIdWireSchema,
  operationId: z.string().min(1),
  instructions: z.string().optional(),
})
export type RotateRequestParams = z.infer<typeof rotateRequestParamsSchema>

export const rotateReplySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started') }),
  z.object({ type: z.literal('refused'), reason: z.string() }),
])
export type RotateReply = z.infer<typeof rotateReplySchema>
