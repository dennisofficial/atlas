import { z } from 'zod'

import { mcpUpsertSchema } from './mcp-wire'
import { ESecretKind } from './secrets-wire'

export enum EConfigScope {
  Default = 'default',
  Workspace = 'workspace',
  User = 'user',
  Project = 'project',
}

export const CONFIG_SCOPE_PRECEDENCE: readonly EConfigScope[] = [
  EConfigScope.Default,
  EConfigScope.Workspace,
  EConfigScope.User,
  EConfigScope.Project,
]

export enum EProvenanceKind {
  Setting = 'setting',
  Secret = 'secret',
  McpServer = 'mcp',
}

export const provenanceKeyOf = (args: { kind: EProvenanceKind; name: string }): string =>
  `${args.kind}:${args.name}`

export const scopedSecretSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  kind: z.enum(ESecretKind),
})
export type ScopedSecret = z.infer<typeof scopedSecretSchema>

export const scopedMcpServerSchema = z.object({
  name: z.string().min(1),
  spec: mcpUpsertSchema,
})
export type ScopedMcpServer = z.infer<typeof scopedMcpServerSchema>

export const resolvedSandboxConfigSchema = z.object({
  settings: z.record(z.string(), z.string()),
  secrets: z.array(scopedSecretSchema),
  mcpServers: z.array(scopedMcpServerSchema),
  provenance: z.record(z.string(), z.enum(EConfigScope)),
})
export type ResolvedSandboxConfig = z.infer<typeof resolvedSandboxConfigSchema>

export const PROVISIONING_ONLY_PREFIX = 'sandbox.vercel'

export const isProvisioningOnlyName = (name: string): boolean => name.startsWith(PROVISIONING_ONLY_PREFIX)

export const workspaceVercelCredentialSchema = z.object({
  configured: z.boolean(),
  teamId: z.string().nullable(),
  updatedAt: z.string().nullable(),
})
export type WorkspaceVercelCredential = z.infer<typeof workspaceVercelCredentialSchema>

export const MAX_VERCEL_FIELD_LENGTH = 500

export const workspaceVercelCredentialUpsertSchema = z.object({
  token: z.string().trim().min(1).max(MAX_VERCEL_FIELD_LENGTH).optional(),
  teamId: z.string().trim().min(1).max(MAX_VERCEL_FIELD_LENGTH),
})
export type WorkspaceVercelCredentialUpsert = z.infer<typeof workspaceVercelCredentialUpsertSchema>

export enum EVercelCredentialGap {
  ProjectWorkspace = 'project-workspace',
  WorkspaceCredential = 'workspace-credential',
  ProjectId = 'project-id',
}

export type VercelProvisioningCredentials = { token: string; teamId: string; projectId: string }
