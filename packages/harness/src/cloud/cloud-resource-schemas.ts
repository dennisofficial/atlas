import { accountIdSchema } from '@dltech/atlas-core'
import { z } from 'zod'

import { mcpSpecSchema, type ParsedMcpSpec } from '../mcp/config/specs'

export const activeAccountResponseSchema = z.object({ accountId: accountIdSchema.nullable() })

export const accessTokenResponseSchema = z.strictObject({
  accessToken: z.string().min(1),
  expiresAt: z.string().nullable(),
})

export type BrokeredAccessToken = z.infer<typeof accessTokenResponseSchema>

export const cloudSecretSchema = z.strictObject({
  name: z.string().min(1),
  value: z.string(),
  updatedAt: z.string(),
})

export type CloudSecret = z.infer<typeof cloudSecretSchema>

export const cloudMcpServerWireSchema = z.strictObject({
  name: mcpSpecSchema.shape.name,
  transport: mcpSpecSchema.shape.transport,
  disabled: mcpSpecSchema.shape.disabled,
  updatedAt: z.string(),
})

export type CloudMcpServer = ParsedMcpSpec & { updatedAt: string }

export const cloudSettingSchema = z.strictObject({
  key: z.string().min(1),
  value: z.string(),
  updatedAt: z.string(),
})

export type CloudSetting = z.infer<typeof cloudSettingSchema>
