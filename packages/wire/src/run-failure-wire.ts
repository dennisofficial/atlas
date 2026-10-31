import { z } from 'zod'

export const runFailureWireSchema = z.object({
  kind: z.string(),
  message: z.string(),
  statusCode: z.number().int().optional(),
  providerCode: z.string().optional(),
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
})

export type RunFailureWire = z.infer<typeof runFailureWireSchema>
