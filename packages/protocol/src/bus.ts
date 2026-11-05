import { z } from 'zod'

export const PG_WAKE_CHANNEL = 'atlas_session_wake'

export const PG_HOST_CHANGE_CHANNEL = 'atlas_host_change'

export const PG_PRESENCE_LOCK_NAMESPACE = 1095060563

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
