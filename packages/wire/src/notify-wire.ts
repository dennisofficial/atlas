import { EClientSurface } from '@dltech/atlas-core'
import { z } from 'zod'

export const reportNotifyPresenceInputSchema = z.strictObject({
  clientId: z.string().min(1).max(64),
  surface: z.enum(EClientSurface),
  sessionId: z.string().min(1).nullable(),
  foreground: z.boolean(),
})
export type ReportNotifyPresenceInput = z.infer<typeof reportNotifyPresenceInputSchema>
