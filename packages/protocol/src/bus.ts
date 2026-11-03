import { z } from 'zod'

export const V2_WAKE_CHANNEL = 'v2:wake'

export const v2WakeMessageSchema = z.strictObject({ sessionId: z.string().min(1) })

export type V2WakeMessage = z.infer<typeof v2WakeMessageSchema>

export const v2LiveChannel = (sessionId: string): string => `v2:live:${sessionId}`
