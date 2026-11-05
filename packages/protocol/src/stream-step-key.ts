import { z } from 'zod'

export const streamStepKeySchema = z.strictObject({
  runId: z.string().min(1),
  step: z.number().int().min(0),
  attempt: z.number().int().min(0),
})
