import { z } from 'zod'

import { scopedFileMountSchema } from './file-mounts-wire'
import { mcpUpsertSchema } from './mcp-wire'
import { EVercelPlan, vercelPlanSchema } from './setting-enums'

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

export enum EVercelCredentialKind {
  Token = 'token',
  Oauth = 'oauth',
}

export enum EVercelConnectStartOutcome {
  Redirect = 'redirect',
  NotConfigured = 'not-configured',
}

export const VERCEL_CONNECT_RESULT_PARAM = 'vercel'
export const VERCEL_CONNECT_REASON_PARAM = 'reason'
export const VERCEL_CONNECT_SETTINGS_PATH = '/settings/usage-sandboxes'

export const userVercelCredentialSchema = vercelCredentialSchema.extend({
  kind: z.enum(EVercelCredentialKind),
  plan: vercelPlanSchema,
  planCheckedAt: z.string().nullable(),
  needsReconnect: z.boolean(),
  vercelUserId: z.string().nullable(),
  oauthConfigured: z.boolean(),
})
export type UserVercelCredential = z.infer<typeof userVercelCredentialSchema>

export const vercelConnectStartSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal(EVercelConnectStartOutcome.Redirect), url: z.url() }),
  z.strictObject({ outcome: z.literal(EVercelConnectStartOutcome.NotConfigured) }),
])
export type VercelConnectStart = z.infer<typeof vercelConnectStartSchema>

export const vercelProjectChoiceSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
})
export type VercelProjectChoice = z.infer<typeof vercelProjectChoiceSchema>

export const vercelProjectsListSchema = z.strictObject({
  projects: z.array(vercelProjectChoiceSchema),
})
export type VercelProjectsList = z.infer<typeof vercelProjectsListSchema>

export const vercelChooseProjectSchema = z.strictObject({
  vercelProjectId: z.string().trim().min(1).max(500),
})
export type VercelChooseProject = z.infer<typeof vercelChooseProjectSchema>

export const vercelTokenDiscoverInputSchema = z.strictObject({
  token: z.string().trim().min(1).max(500).optional(),
  teamId: z.string().trim().min(1).max(500).optional(),
})
export type VercelTokenDiscoverInput = z.infer<typeof vercelTokenDiscoverInputSchema>

export const vercelTeamChoiceSchema = z.strictObject({
  id: z.string(),
  slug: z.string(),
  name: z.string().nullable(),
  plan: vercelPlanSchema,
})
export type VercelTeamChoice = z.infer<typeof vercelTeamChoiceSchema>

export const vercelTokenDiscoverSchema = z.strictObject({
  teams: z.array(vercelTeamChoiceSchema),
  projects: z.array(vercelProjectChoiceSchema),
})
export type VercelTokenDiscover = z.infer<typeof vercelTokenDiscoverSchema>

export { EVercelPlan }

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
