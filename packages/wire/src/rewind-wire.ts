import { z } from 'zod'

const threadIdWireSchema = z.string().min(1).brand<'ThreadId'>()

export const rewindCutWireSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('agent'),
    agentId: threadIdWireSchema,
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
    agentId: threadIdWireSchema,
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
  threadId: threadIdWireSchema,
  cuts: z.array(rewindCutWireSchema),
  /**
   * The point the operator picked. A serve whose durable log is local (the sandbox's own JSONL)
   * truncates it as part of the same apply, so the kill and the truncation are one request; a serve
   * built before the transcript moved off the control plane has no `toSeq` and is never sent one.
   */
  toSeq: z.number().int().nonnegative().optional(),
})

export type RewindApplyParams = z.infer<typeof rewindApplyParamsSchema>
