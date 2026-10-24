import { z } from 'zod'

import { projectIdInputSchema } from '../project-wire'
import { mcpServerSchema, mcpUpsertSchema } from './mcp-wire'
import { projectSandboxSchema } from './project-settings-wire'
import { vercelCredentialUpsertSchema } from './scoped-config-wire'
import { secretDetailSchema, secretSetSchema, workspaceSecretSchema } from './secrets-wire'
import { settingsPatchSchema } from './settings-wire'

const resourceNameShape = { name: z.string().min(1) }

export const organizationIdInputSchema = z.strictObject({ organizationId: z.string().min(1) })
export type OrganizationIdInput = z.infer<typeof organizationIdInputSchema>

export const projectSecretListSchema = z.object({ secrets: z.array(secretDetailSchema) })
export type ProjectSecretList = z.infer<typeof projectSecretListSchema>

export const workspaceSecretListSchema = z.object({ secrets: z.array(workspaceSecretSchema) })
export type WorkspaceSecretList = z.infer<typeof workspaceSecretListSchema>

export const resourceMcpServerListSchema = z.object({ servers: z.array(mcpServerSchema) })
export type ResourceMcpServerList = z.infer<typeof resourceMcpServerListSchema>

export const projectSecretKeySchema = projectIdInputSchema.extend(resourceNameShape)
export type ProjectSecretKey = z.infer<typeof projectSecretKeySchema>

export const workspaceSecretKeySchema = organizationIdInputSchema.extend(resourceNameShape)
export type WorkspaceSecretKey = z.infer<typeof workspaceSecretKeySchema>

export const projectSecretSetSchema = secretSetSchema.extend(projectSecretKeySchema.shape)
export type ProjectSecretSet = z.infer<typeof projectSecretSetSchema>

export const workspaceSecretSetSchema = secretSetSchema.extend(workspaceSecretKeySchema.shape)
export type WorkspaceSecretSet = z.infer<typeof workspaceSecretSetSchema>

export const projectMcpServerKeySchema = projectSecretKeySchema
export type ProjectMcpServerKey = z.infer<typeof projectMcpServerKeySchema>

export const workspaceMcpServerKeySchema = workspaceSecretKeySchema
export type WorkspaceMcpServerKey = z.infer<typeof workspaceMcpServerKeySchema>

export const projectMcpServerPutSchema = mcpUpsertSchema.extend(projectSecretKeySchema.shape)
export type ProjectMcpServerPut = z.infer<typeof projectMcpServerPutSchema>

export const workspaceMcpServerPutSchema = mcpUpsertSchema.extend(workspaceSecretKeySchema.shape)
export type WorkspaceMcpServerPut = z.infer<typeof workspaceMcpServerPutSchema>

export const projectSettingsPatchSchema = settingsPatchSchema.extend(projectIdInputSchema.shape)
export type ProjectSettingsPatch = z.infer<typeof projectSettingsPatchSchema>

export const workspaceSettingsPatchSchema = settingsPatchSchema.extend(
  organizationIdInputSchema.shape,
)
export type WorkspaceSettingsPatch = z.infer<typeof workspaceSettingsPatchSchema>

export const projectSandboxSaveSchema = z.strictObject({
  ...projectSandboxSchema.shape,
  ...projectIdInputSchema.shape,
})
export type ProjectSandboxSave = z.infer<typeof projectSandboxSaveSchema>

export const workspaceVercelSaveSchema = vercelCredentialUpsertSchema.extend(
  organizationIdInputSchema.shape,
)
export type WorkspaceVercelSave = z.infer<typeof workspaceVercelSaveSchema>

export const sandboxConfigInputSchema = z
  .strictObject({ projectId: z.string().optional() })
  .optional()
export type SandboxConfigInput = z.infer<typeof sandboxConfigInputSchema>
