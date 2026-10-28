import { z } from 'zod'

import { projectIdInputSchema } from '../project-wire'
import { mcpServerSchema, mcpUpsertSchema } from './mcp-wire'
import { projectSandboxSchema } from './project-settings-wire'
import { secretDetailSchema, secretSetSchema } from './secrets-wire'
import { settingsPatchSchema } from './settings-wire'

const resourceNameShape = { name: z.string().min(1) }

export const projectSecretListSchema = z.object({ secrets: z.array(secretDetailSchema) })
export type ProjectSecretList = z.infer<typeof projectSecretListSchema>

export const resourceMcpServerListSchema = z.object({ servers: z.array(mcpServerSchema) })
export type ResourceMcpServerList = z.infer<typeof resourceMcpServerListSchema>

export const projectSecretKeySchema = projectIdInputSchema.extend(resourceNameShape)
export type ProjectSecretKey = z.infer<typeof projectSecretKeySchema>

export const projectSecretSetSchema = secretSetSchema.extend(projectSecretKeySchema.shape)
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
