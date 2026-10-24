import { z } from 'zod'

import { storedAccountDtoSchema } from './account-routes-wire.js'

export const accountLeaseSchema = z.object({
  accounts: z.array(storedAccountDtoSchema),
  active: z.array(z.object({ provider: z.string(), accountId: z.string() })),
})
export type AccountLease = z.infer<typeof accountLeaseSchema>
