import { z } from 'zod'

export enum ERuntimePhase {
  Running = 'running',
  Parked = 'parked',
  Stopped = 'stopped',
}

export const transcriptCheckpointSchema = z.strictObject({
  head: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
})
export type TranscriptCheckpoint = z.infer<typeof transcriptCheckpointSchema>

export const runtimeCheckpointSchema = z.strictObject({
  threadId: z.string().min(1),
  runtimeId: z.string().min(1),
  sandboxSessionId: z.string().min(1),
  revision: z.number().int().min(1).max(2147483647),
  phase: z.enum(ERuntimePhase),
  reportedAt: z.iso.datetime(),
  transcript: transcriptCheckpointSchema,
})
export type RuntimeCheckpoint = z.infer<typeof runtimeCheckpointSchema>

export const readRuntimeCheckpointReplySchema = z.object({
  checkpoint: runtimeCheckpointSchema.nullable(),
})
export type ReadRuntimeCheckpointReply = z.infer<typeof readRuntimeCheckpointReplySchema>
