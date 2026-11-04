import { z } from 'zod'

export const WAKE_CHANNEL = 'atlas:session-wake'

export const PG_WAKE_CHANNEL = 'atlas_session_wake'

export const wakeMessageSchema = z.strictObject({ sessionId: z.string().min(1) })

export type WakeMessage = z.infer<typeof wakeMessageSchema>

export const sessionLiveChannel = (sessionId: string): string => `atlas:session-live:${sessionId}`

export const liveFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('tool-output'), callId: z.string().min(1), text: z.string() }),
  z.strictObject({
    type: z.literal('retrying'),
    attempt: z.number().int().min(1),
    maxAttempts: z.number().int().min(1),
    reason: z.string().min(1),
    delayMs: z.number().min(0),
  }),
  z.strictObject({ type: z.literal('status'), state: z.string().min(1) }),
])

export type LiveFrame = z.infer<typeof liveFrameSchema>
