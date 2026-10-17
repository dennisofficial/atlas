import { z } from 'zod'

export enum ERuntimePhase {
  Provisioning = 'provisioning',
  Serving = 'serving',
  Parking = 'parking',
  Parked = 'parked',
  Waking = 'waking',
  Updating = 'updating',
}

export const transcriptCheckpointSchema = z.strictObject({
  head: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
})
export type TranscriptCheckpoint = z.infer<typeof transcriptCheckpointSchema>

const lifecycleBase = {
  threadId: z.string().min(1),
  runtimeId: z.string().min(1),
  sandboxSessionId: z.string().min(1),
  revision: z.number().int().min(1).max(2147483647),
  reportedAt: z.iso.datetime(),
  transcript: transcriptCheckpointSchema,
}

const updatingLifecycleCheckpointSchema = z.strictObject({
  ...lifecycleBase,
  phase: z.literal(ERuntimePhase.Updating),
})

export const sandboxRotationReceiptSchema = z.object({
  version: z.literal(1),
  threadId: z.string().min(1),
  sandboxSessionId: z.string().min(1),
  resumeParent: z.boolean(),
  resumeChildren: z.array(z.string().min(1)).optional(),
  checkpoint: updatingLifecycleCheckpointSchema,
}).refine((receipt) =>
  receipt.checkpoint.threadId === receipt.threadId &&
  receipt.checkpoint.sandboxSessionId === receipt.sandboxSessionId,
)

export type SandboxRotationReceipt = z.infer<typeof sandboxRotationReceiptSchema>

export const runtimeCheckpointSchema = z.discriminatedUnion('phase', [
  z.strictObject({ ...lifecycleBase, phase: z.literal(ERuntimePhase.Provisioning) }),
  z.strictObject({
    ...lifecycleBase,
    phase: z.literal(ERuntimePhase.Serving),
    // A rotation's owed obligations ride the serving record after the swap reopens; each
    // consumption rewrites it, and the field drops once nothing is owed.
    receipt: sandboxRotationReceiptSchema.optional(),
  }),
  z.strictObject({
    ...lifecycleBase,
    phase: z.literal(ERuntimePhase.Parking),
    park: z.strictObject({ attempts: z.number().int().nonnegative() }).optional(),
  }),
  z.strictObject({ ...lifecycleBase, phase: z.literal(ERuntimePhase.Parked) }),
  z.strictObject({ ...lifecycleBase, phase: z.literal(ERuntimePhase.Waking) }),
  updatingLifecycleCheckpointSchema.extend({ receipt: sandboxRotationReceiptSchema }),
])
export type RuntimeCheckpoint = z.infer<typeof runtimeCheckpointSchema>

export const RUNTIME_PHASE_SUCCESSORS: Readonly<Record<ERuntimePhase, readonly ERuntimePhase[]>> = {
  [ERuntimePhase.Provisioning]: [ERuntimePhase.Serving],
  [ERuntimePhase.Serving]: [ERuntimePhase.Parking, ERuntimePhase.Updating],
  [ERuntimePhase.Parking]: [ERuntimePhase.Parked, ERuntimePhase.Serving],
  [ERuntimePhase.Parked]: [ERuntimePhase.Waking],
  [ERuntimePhase.Waking]: [ERuntimePhase.Serving, ERuntimePhase.Updating],
  [ERuntimePhase.Updating]: [ERuntimePhase.Serving],
}

export const canTransition = (args: { from: ERuntimePhase; to: ERuntimePhase }): boolean =>
  RUNTIME_PHASE_SUCCESSORS[args.from].includes(args.to)

export const admissionClosedFor = (phase: ERuntimePhase): boolean =>
  phase === ERuntimePhase.Parking ||
  phase === ERuntimePhase.Parked ||
  phase === ERuntimePhase.Updating

export const readRuntimeCheckpointReplySchema = z.object({
  checkpoint: runtimeCheckpointSchema.nullable(),
})
export type ReadRuntimeCheckpointReply = z.infer<typeof readRuntimeCheckpointReplySchema>
