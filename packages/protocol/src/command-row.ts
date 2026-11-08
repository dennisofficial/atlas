import { z } from 'zod'

export enum ECommandState {
  Queued = 'queued',
  Running = 'running',
}

export const sessionCommandRowSchema = z.strictObject({
  inboxId: z.number().int().min(1),
  name: z.string().min(1),
  postedAt: z.string().min(1),
  state: z.enum(ECommandState),
})

export type SessionCommandRow = z.infer<typeof sessionCommandRowSchema>
