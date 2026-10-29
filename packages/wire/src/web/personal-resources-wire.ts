import { z } from 'zod'

import { mcpServerSchema, mcpUpsertSchema } from './mcp-wire'
import {
  secretSetSchema,
  secretSummarySchema,
  secretValueSchema,
  type SecretValue,
} from './secrets-wire'

export const personalSettingKeySchema = z.strictObject({ key: z.string().min(1) })
export type PersonalSettingKey = z.infer<typeof personalSettingKeySchema>

export const personalSettingSetSchema = personalSettingKeySchema.extend({ value: z.string() })
export type PersonalSettingSet = z.infer<typeof personalSettingSetSchema>

export const personalSecretSchema = z.object({
  name: z.string(),
  value: z.string(),
  updatedAt: z.string(),
})
export type PersonalSecret = z.infer<typeof personalSecretSchema>

export const personalSecretListSchema = z.object({ secrets: z.array(personalSecretSchema) })
export type PersonalSecretList = z.infer<typeof personalSecretListSchema>

export const personalSecretSummaryListSchema = z.object({ secrets: z.array(secretSummarySchema) })
export type PersonalSecretSummaryList = z.infer<typeof personalSecretSummaryListSchema>

export const personalSecretValueSchema = secretValueSchema
export type PersonalSecretValue = SecretValue

export const personalSecretNamesSchema = z.object({ names: z.array(z.string()) })
export type PersonalSecretNames = z.infer<typeof personalSecretNamesSchema>

export const personalSecretNameSchema = z.strictObject({ name: z.string().min(1) })
export type PersonalSecretName = z.infer<typeof personalSecretNameSchema>

export const personalSecretSetSchema = secretSetSchema.extend(personalSecretNameSchema.shape)
export type PersonalSecretSet = z.infer<typeof personalSecretSetSchema>

export const personalMcpServerListSchema = z.object({ servers: z.array(mcpServerSchema) })
export type PersonalMcpServerList = z.infer<typeof personalMcpServerListSchema>

export const personalMcpNameSchema = z.strictObject({ name: z.string().min(1) })
export type PersonalMcpName = z.infer<typeof personalMcpNameSchema>

export const personalMcpUpsertSchema = mcpUpsertSchema.extend(personalMcpNameSchema.shape)
export type PersonalMcpUpsert = z.infer<typeof personalMcpUpsertSchema>
