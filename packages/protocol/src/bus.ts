import { z } from 'zod'

export const WAKE_CHANNEL = 'atlas:session-wake'

export const wakeMessageSchema = z.strictObject({ sessionId: z.string().min(1) })

export type WakeMessage = z.infer<typeof wakeMessageSchema>

export const sessionLiveChannel = (sessionId: string): string => `atlas:session-live:${sessionId}`
