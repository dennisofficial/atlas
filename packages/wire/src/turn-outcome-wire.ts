import { z } from 'zod'

import { runFailureWireSchema } from './run-failure-wire'

export enum ETurnStatus {
  Completed = 'completed',
  Paused = 'paused',
  Idle = 'idle',
  Interrupted = 'interrupted',
  RelocationPaused = 'relocation-paused',
  Failed = 'failed',
}

export const runIdWireSchema = z.string().min(1).brand<'RunId'>()
export const callIdWireSchema = z.string().min(1).brand<'CallId'>()
export const sendIdWireSchema = z.string().min(1).brand<'SendId'>()

export type SendId = z.infer<typeof sendIdWireSchema>

export const toSendId = (value: string): SendId => sendIdWireSchema.parse(value)

export const turnOutcomeWireSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal(ETurnStatus.Completed), runId: runIdWireSchema }),
  z.object({
    status: z.literal(ETurnStatus.Paused),
    runId: runIdWireSchema,
    callId: callIdWireSchema,
    reason: z.string(),
  }),
  z.object({ status: z.literal(ETurnStatus.Idle), runId: runIdWireSchema }),
  z.object({
    status: z.literal(ETurnStatus.Interrupted),
    runId: runIdWireSchema,
    committed: z.boolean(),
  }),
  z.object({
    status: z.literal(ETurnStatus.RelocationPaused),
    runId: runIdWireSchema,
  }),
  z.object({
    status: z.literal(ETurnStatus.Failed),
    runId: runIdWireSchema,
    message: z.string(),
    failure: runFailureWireSchema.optional(),
  }),
])

export type TurnOutcomeWire = z.infer<typeof turnOutcomeWireSchema>
