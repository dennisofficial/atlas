import { z } from 'zod'

export const accountLeaseSchema = z.object({
  accounts: z.array(z.unknown()),
  active: z.array(z.object({ provider: z.string(), accountId: z.string() })),
})
export type AccountLease = z.infer<typeof accountLeaseSchema>
