import { z } from 'zod'

import { sandboxRotationReceiptSchema } from './runtime-checkpoint.js'

export { sandboxRotationReceiptSchema }
export type { SandboxRotationReceipt } from './runtime-checkpoint.js'

export const sandboxRotationIntentSchema = z.object({
  version: z.literal(1),
  preparing: z.literal(true),
  threadId: z.string().min(1),
  sandboxSessionId: z.string().min(1),
  resumeParent: z.boolean(),
  resumeChildren: z.array(z.string().min(1)).optional(),
})

export const sandboxRotationStateSchema = z.union([
  sandboxRotationReceiptSchema,
  sandboxRotationIntentSchema,
])

export type SandboxRotationState = z.infer<typeof sandboxRotationStateSchema>

export const sandboxDrainReplySchema = z.object({
  ok: z.literal(true),
  prepared: z.literal(true),
  receipt: sandboxRotationReceiptSchema,
})

export type SandboxDrainReply = z.infer<typeof sandboxDrainReplySchema>
