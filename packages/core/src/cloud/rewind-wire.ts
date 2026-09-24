import { z } from 'zod'

import { threadIdSchema } from '../events/ids'

export const rewindCutWireSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('agent'),
    agentId: threadIdSchema,
    agentType: z.string(),
    intent: z.string(),
  }),
  z.object({
    kind: z.literal('shell'),
    shellId: z.string().min(1),
    command: z.string().optional(),
    description: z.string().optional(),
  }),
  z.object({
    kind: z.literal('service'),
    serviceId: z.string().min(1),
    command: z.string().optional(),
    description: z.string().optional(),
  }),
])

export type RewindCutWire = z.infer<typeof rewindCutWireSchema>

export const rewindKillWireSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('agent'),
    agentId: threadIdSchema,
    agentType: z.string(),
    intent: z.string(),
    running: z.boolean(),
  }),
  z.object({
    kind: z.literal('shell'),
    shellId: z.string().min(1),
    command: z.string().optional(),
    description: z.string().optional(),
    running: z.boolean(),
  }),
  z.object({
    kind: z.literal('service'),
    serviceId: z.string().min(1),
    command: z.string().optional(),
    description: z.string().optional(),
    running: z.boolean(),
  }),
])

export type RewindKillWire = z.infer<typeof rewindKillWireSchema>

export const rewindApplyParamsSchema = z.object({
  threadId: threadIdSchema,
  cuts: z.array(rewindCutWireSchema),
})

export type RewindApplyParams = z.infer<typeof rewindApplyParamsSchema>
