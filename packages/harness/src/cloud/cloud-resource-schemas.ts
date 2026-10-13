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

export const userFileMetaSchema = z.object({
  path: z.string().min(1),
  revision: z.number().int().min(0),
  contentHash: z.string(),
  tombstonedAt: z.string().nullable(),
})

export type UserFileMeta = z.infer<typeof userFileMetaSchema>

export const userFileListResponseSchema = z.object({ files: z.array(userFileMetaSchema) })

export const userFileContentResponseSchema = z.object({
  files: z.array(userFileMetaSchema.extend({ content: z.string().nullable() })),
})

export const userFileRevisionResponseSchema = z.object({ revision: z.number().int().min(0) })
