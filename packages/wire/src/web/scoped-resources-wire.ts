import { z } from 'zod'

import { projectIdInputSchema } from '../project-wire'
import { configLayerOwnerSchema, configLayerSchema } from '../project-group-wire'
import { mcpServerSchema, mcpUpsertSchema } from './mcp-wire'
import { projectSandboxSchema } from './project-settings-wire'
import { secretSetSchema, secretSummarySchema, secretValueSchema } from './secrets-wire'
import { settingsPatchSchema } from './settings-wire'

const resourceNameShape = { name: z.string().min(1) }

export const projectSecretListSchema = z.object({ secrets: z.array(secretSummarySchema) })
export type ProjectSecretList = z.infer<typeof projectSecretListSchema>

export const projectSecretValueSchema = secretValueSchema
export type ProjectSecretValue = z.infer<typeof projectSecretValueSchema>

export const resourceMcpServerListSchema = z.object({ servers: z.array(mcpServerSchema) })
export type ResourceMcpServerList = z.infer<typeof resourceMcpServerListSchema>

export const projectSecretKeySchema = projectIdInputSchema.extend(resourceNameShape)
export type ProjectSecretKey = z.infer<typeof projectSecretKeySchema>

export const projectSecretSetSchema = secretSetSchema.extend({
  ...projectSecretKeySchema.shape,
  grantId: z.string().min(1).optional(),
})
export type ProjectSecretSet = z.infer<typeof projectSecretSetSchema>

export const projectMcpServerKeySchema = projectSecretKeySchema
export type ProjectMcpServerKey = z.infer<typeof projectMcpServerKeySchema>

export const projectMcpServerPutSchema = mcpUpsertSchema.extend(projectSecretKeySchema.shape)
export type ProjectMcpServerPut = z.infer<typeof projectMcpServerPutSchema>

export const projectSettingsPatchSchema = settingsPatchSchema.extend(projectIdInputSchema.shape)
export type ProjectSettingsPatch = z.infer<typeof projectSettingsPatchSchema>

export const projectSandboxSaveSchema = z.strictObject({
  ...projectSandboxSchema.shape,
  ...projectIdInputSchema.shape,
})
export type ProjectSandboxSave = z.infer<typeof projectSandboxSaveSchema>

export const sandboxConfigInputSchema = z
  .strictObject({ projectId: z.string().optional() })
  .optional()
export type SandboxConfigInput = z.infer<typeof sandboxConfigInputSchema>

export const layeredSettingValueSchema = z.object({
  key: z.string(),
  value: z.string(),
  overriddenBy: configLayerSchema.nullable(),
})
export type LayeredSettingValue = z.infer<typeof layeredSettingValueSchema>

export const layeredSettingLayerSchema = z.object({
  layer: configLayerSchema,
  owner: configLayerOwnerSchema,
  values: z.array(layeredSettingValueSchema),
})
export type LayeredSettingLayer = z.infer<typeof layeredSettingLayerSchema>

export const layeredSettingsSchema = z.object({ layers: z.array(layeredSettingLayerSchema) })
export type LayeredSettings = z.infer<typeof layeredSettingsSchema>

export const GROUP_INSTRUCTION_CHAR_LIMIT = 8000

export const groupInstructionSchema = z.object({
  content: z.string(),
  updatedAt: z.string().nullable(),
})
export type GroupInstruction = z.infer<typeof groupInstructionSchema>

export const groupInstructionSaveSchema = z.strictObject({
  groupId: z.string().min(1),
  content: z.string().max(GROUP_INSTRUCTION_CHAR_LIMIT),
})
export type GroupInstructionSave = z.infer<typeof groupInstructionSaveSchema>
