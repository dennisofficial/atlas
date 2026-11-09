import { z } from 'zod'

export const presenceClientIdSchema = z.string().min(1).max(64)

export const reportPresenceInputSchema = z.strictObject({
  clientId: presenceClientIdSchema,
  threadId: z.string().min(1).nullable(),
})
export type ReportPresenceInput = z.infer<typeof reportPresenceInputSchema>
