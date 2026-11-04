import { z } from 'zod'

export const GATEWAY_MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models'
export const GATEWAY_SOURCE = 'ai-gateway.vercel.sh'

const reasoningOptionSchema = z.object({
  type: z.string(),
  values: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
})

const modelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  context_window: z.number().optional(),
  max_tokens: z.number().optional(),
  tags: z.array(z.string()).optional(),
  reasoning_options: z.array(reasoningOptionSchema).nullable().optional(),
  pricing: z
    .object({
      input: z.string().optional(),
      output: z.string().optional(),
      input_cache_read: z.string().optional(),
      input_cache_write: z.string().optional(),
    })
    .optional(),
})

const listSchema = z.object({ data: z.array(modelSchema) })

export type GatewayModel = z.infer<typeof modelSchema>

export async function fetchGatewayModels(
  url: string = GATEWAY_MODELS_URL,
): Promise<readonly GatewayModel[]> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status} ${response.statusText}`)
  }

  return listSchema.parse(await response.json()).data
}
