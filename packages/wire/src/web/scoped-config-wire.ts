import { z } from 'zod'

import { scopedFileMountSchema } from './file-mounts-wire'
import { mcpUpsertSchema } from './mcp-wire'

export enum EConfigScope {
  Default = 'default',
  User = 'user',
  Project = 'project',
}

export const CONFIG_SCOPE_PRECEDENCE: readonly EConfigScope[] = [
  EConfigScope.Default,
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
})
export type ScopedSecret = z.infer<typeof scopedSecretSchema>

export const scopedMcpServerSchema = z.object({ name: z.string().min(1), spec: mcpUpsertSchema })
export type ScopedMcpServer = z.infer<typeof scopedMcpServerSchema>

export const resolvedSandboxConfigSchema = z.object({
  settings: z.record(z.string(), z.string()),
  secrets: z.array(scopedSecretSchema),
  harnessSecrets: z.array(scopedSecretSchema),
  mcpServers: z.array(scopedMcpServerSchema),
  fileMounts: z.array(scopedFileMountSchema).default([]),
  provenance: z.record(z.string(), z.enum(EConfigScope)),
})
export type ResolvedSandboxConfig = z.infer<typeof resolvedSandboxConfigSchema>

export const PROVISIONING_ONLY_PREFIX = 'sandbox.vercel'

export const isProvisioningOnlyName = (name: string): boolean =>
  name.startsWith(PROVISIONING_ONLY_PREFIX)

export const vercelCredentialSchema = z.object({
  configured: z.boolean(),
  teamId: z.string().nullable(),
  vercelProjectId: z.string().nullable(),
  updatedAt: z.string().nullable(),
})
export type VercelCredentialView = z.infer<typeof vercelCredentialSchema>

export const userVercelCredentialSchema = vercelCredentialSchema
export type UserVercelCredential = VercelCredentialView

export const MAX_VERCEL_FIELD_LENGTH = 500

export const vercelCredentialUpsertSchema = z.object({
  token: z.string().trim().min(1).max(MAX_VERCEL_FIELD_LENGTH).optional(),
  teamId: z.string().trim().min(1).max(MAX_VERCEL_FIELD_LENGTH),
  vercelProjectId: z.string().trim().min(1).max(MAX_VERCEL_FIELD_LENGTH),
})
export type VercelCredentialUpsert = z.infer<typeof vercelCredentialUpsertSchema>

export const userVercelCredentialUpsertSchema = vercelCredentialUpsertSchema
export type UserVercelCredentialUpsert = VercelCredentialUpsert

export type VercelProvisioningCredentials = { token: string; teamId: string; projectId: string }
