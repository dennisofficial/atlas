import { z } from 'zod'

import { threadIdWireSchema } from './request-wire.js'

export enum EWireRotationPhase {
  Preparing = 'preparing',
  Settling = 'settling',
  Writing = 'writing',
  Activating = 'activating',
  Failed = 'failed',
}

export const rotationStateWireSchema = z.object({
  phase: z.nativeEnum(EWireRotationPhase),
  successor: threadIdWireSchema.optional(),
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
