import { z } from 'zod'

import { scopedFileMountSchema } from './file-mounts-wire'
import { mcpUpsertSchema } from './mcp-wire'
import { EVercelPlan } from './setting-enums'

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

export { EVercelPlan }

export type VercelProvisioningCredentials = { token: string; teamId: string; projectId: string }
