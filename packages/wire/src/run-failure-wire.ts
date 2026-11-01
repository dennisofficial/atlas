import { z } from 'zod'

const isoInstantSchema = z.iso.datetime({ offset: true })

export const runFailureWireSchema = z.object({
  kind: z.string(),
  message: z.string(),
  statusCode: z.number().int().optional(),
  providerCode: z.string().optional(),
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  retryAt: isoInstantSchema.optional(),
  resetAt: isoInstantSchema.optional(),
})

export type RunFailureWire = z.infer<typeof runFailureWireSchema>
