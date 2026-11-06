import { EStepEndReason } from '@dltech/atlas-core'
import { z } from 'zod'

import { EStreamBlockKind } from './stream-constants'
import { streamStepKeySchema } from './stream-step-key'

export const PG_WAKE_CHANNEL = 'atlas_session_wake'

export const PG_CHANGE_CHANNEL = 'atlas_session_changed'

export const PG_HOST_CHANGE_CHANNEL = 'atlas_host_change'

export const PG_PRESENCE_LOCK_NAMESPACE = 1095060563

export const sessionLiveChannel = (sessionId: string): string => `atlas:session-live:${sessionId}`

export const sessionLiveBufferKey = (sessionId: string): string =>
  `atlas:session-live-buf:${sessionId}`

const SETUP_OUTPUT_CALL_PREFIX = 'setup:'

export const setupOutputCallId = (sessionId: string): string =>
  `${SETUP_OUTPUT_CALL_PREFIX}${sessionId}`

export const isSetupOutputCallId = (callId: string): boolean =>
  callId.startsWith(SETUP_OUTPUT_CALL_PREFIX)

export const frameStampSchema = z.strictObject({
  epoch: z.number().int().min(0),
  n: z.number().int().min(0),
})

export type FrameStamp = z.infer<typeof frameStampSchema>

export const compareFrameStamp = (args: { left: FrameStamp; right: FrameStamp }): number =>
  args.left.epoch - args.right.epoch || args.left.n - args.right.n

export const liveFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('tool-output'), callId: z.string().min(1), text: z.string() }),
  z.strictObject({
    type: z.literal('retrying'),
    attempt: z.number().int().min(1),
    maxAttempts: z.number().int().min(1),
    reason: z.string().min(1),
    delayMs: z.number().min(0),
  }),
  z.strictObject({
    type: z.literal('step-start'),
    key: streamStepKeySchema,
    afterSeq: z.number().int().min(0),
    at: frameStampSchema,
  }),
  z.strictObject({
    type: z.literal('delta'),
    key: streamStepKeySchema,
    block: z.string().min(1),
    kind: z.enum(EStreamBlockKind),
    from: z.number().int().min(0),
    text: z.string(),
    at: frameStampSchema,
  }),
  z.strictObject({
    type: z.literal('step-end'),
    key: streamStepKeySchema,
    reason: z.enum(EStepEndReason),
    at: frameStampSchema,
  }),
])

export type LiveFrame = z.infer<typeof liveFrameSchema>

export const sessionChangeSchema = z.strictObject({
  sessionId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  headSeq: z.number().int().min(0).optional(),
})

export type SessionChange = z.infer<typeof sessionChangeSchema>
