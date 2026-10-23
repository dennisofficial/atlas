import { z } from 'zod'

export enum EModelProviderStatus {
  Connected = 'connected',
  Expired = 'expired',
}

export const modelEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  contextWindow: z.number(),
  imageTier: z.string().optional(),
  efforts: z.array(z.string()),
  inputPerMillion: z.number().optional(),
})

export const modelProviderSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(EModelProviderStatus),
  live: z.boolean(),
  models: z.array(modelEntrySchema),
})

export const modelsResponseSchema = z.object({
  providers: z.array(modelProviderSchema),
  liveError: z.string().optional(),
})

export type ModelEntry = z.infer<typeof modelEntrySchema>
export type ModelProvider = z.infer<typeof modelProviderSchema>
export type ModelsResponse = z.infer<typeof modelsResponseSchema>
