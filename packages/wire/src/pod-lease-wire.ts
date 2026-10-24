import { z } from 'zod'

export const MAX_POD_TOKEN_LENGTH = 512

export const registerPodLeaseInputSchema = z.strictObject({
  threadId: z.string().min(1),
  token: z.string().min(1).max(MAX_POD_TOKEN_LENGTH),
})
export type RegisterPodLeaseInput = z.infer<typeof registerPodLeaseInputSchema>

export const releasePodLeaseInputSchema = z.strictObject({ threadId: z.string().min(1) })
export type ReleasePodLeaseInput = z.infer<typeof releasePodLeaseInputSchema>
