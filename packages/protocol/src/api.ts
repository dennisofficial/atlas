import { ESessionStatus } from '@dltech/atlas-core'
import { z } from 'zod'

export const sessionCreateInputSchema = z.strictObject({
  projectId: z.string().min(1),
  title: z.string().optional(),
})

export const sessionListInputSchema = z.strictObject({
  projectId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

export const sessionPostInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  text: z.string().min(1),
})

export const sessionEventsInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  afterSeq: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
})

export const sessionStatusInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export const agentHostConfigInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export const agentHostModelAccessTokenInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  connectionId: z.string().min(1),
  rejectedAccessToken: z.string().optional(),
})

export const agentHostGithubTokenInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export type SessionCreateInput = z.infer<typeof sessionCreateInputSchema>
export type SessionListInput = z.infer<typeof sessionListInputSchema>
export type SessionPostInput = z.infer<typeof sessionPostInputSchema>
export type SessionEventsInput = z.infer<typeof sessionEventsInputSchema>
export type SessionStatusInput = z.infer<typeof sessionStatusInputSchema>
export type AgentHostConfigInput = z.infer<typeof agentHostConfigInputSchema>
export type AgentHostModelAccessTokenInput = z.infer<typeof agentHostModelAccessTokenInputSchema>
export type AgentHostGithubTokenInput = z.infer<typeof agentHostGithubTokenInputSchema>

export const inboxMessageSchema = z.strictObject({ text: z.string().min(1) })

export type InboxMessage = z.infer<typeof inboxMessageSchema>

export const INBOX_KIND_MESSAGE = 'message'

export const sessionCreateOutputSchema = z.strictObject({
  sessionId: z.string().min(1),
  mainThreadId: z.string().min(1),
})

export const sessionSummarySchema = z.strictObject({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().nullable(),
  mainThreadId: z.string().min(1),
  createdAt: z.string().min(1),
})

export const sessionListOutputSchema = z.strictObject({
  sessions: z.array(sessionSummarySchema),
})

export const sessionPostOutputSchema = z.strictObject({ inboxId: z.number().int().min(1) })

export const sessionEventsOutputSchema = z.strictObject({
  events: z.array(z.record(z.string(), z.unknown())),
  next: z.number().int().min(1).optional(),
})

export const sessionLeaseSchema = z.strictObject({
  epoch: z.number().int().min(0),
  holderId: z.string().nullable(),
  live: z.boolean(),
})

export const sessionStatusOutputSchema = z.strictObject({
  state: z.enum(ESessionStatus),
  reason: z.string().optional(),
  since: z.string().optional(),
  lease: sessionLeaseSchema,
})

const v2ScopedSecretSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
})

const v2ScopedMcpServerSchema = z.object({
  name: z.string().min(1),
  spec: z.record(z.string(), z.unknown()),
})

const v2ScopedFileMountSchema = z.object({
  path: z.string().min(1),
  contents: z.string(),
  mode: z.string().min(1),
})

const v2ProjectConfigSchema = z.object({
  settings: z.record(z.string(), z.string()),
  secrets: z.array(v2ScopedSecretSchema),
  harnessSecrets: z.array(v2ScopedSecretSchema),
  mcpServers: z.array(v2ScopedMcpServerSchema),
  fileMounts: z.array(v2ScopedFileMountSchema),
  provenance: z.record(z.string(), z.string()),
})

export const agentHostModelCredentialSchema = z.union([
  z.strictObject({ kind: z.literal('oauth'), connectionId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('api-key'), apiKey: z.string().min(1) }),
])

export const agentHostModelConfigSchema = z.union([
  z.strictObject({
    configured: z.literal(true),
    modelId: z.string().min(1),
    accountId: z.string().min(1),
    credential: agentHostModelCredentialSchema,
  }),
  z.strictObject({ configured: z.literal(false), gap: z.string().min(1) }),
])

export const agentHostWorkspaceRepoSchema = z.strictObject({
  repo: z.string().min(1),
  branch: z.string().min(1).optional(),
})

export const agentHostWorkspaceSchema = z.strictObject({
  remoteUrl: z.string().min(1).nullable(),
  baseBranch: z.string().min(1).nullable(),
  additionalRepos: z.array(agentHostWorkspaceRepoSchema),
  setupScript: z.string(),
})

export const agentHostConfigOutputSchema = z.strictObject({
  userId: z.string().min(1),
  projectId: z.string().min(1),
  model: agentHostModelConfigSchema,
  workspace: agentHostWorkspaceSchema,
  vercel: z.union([
    z.strictObject({
      configured: z.literal(true),
      token: z.string().min(1),
      teamId: z.string().min(1),
      projectId: z.string().min(1),
    }),
    z.strictObject({ configured: z.literal(false), gap: z.string().min(1) }),
  ]),
  config: v2ProjectConfigSchema,
  revision: z.string().min(1),
  expiresAt: z.string().min(1),
})

export const agentHostModelAccessTokenOutputSchema = z.strictObject({
  accessToken: z.string().min(1),
  expiresAt: z.string().min(1),
  refreshAfter: z.string().min(1),
  generation: z.number().int().min(0),
  authorizationId: z.string().min(1),
  providerAccountId: z.string().optional(),
})

export const agentHostGithubTokenOutputSchema = z.strictObject({
  token: z.string().min(1).nullable(),
})

export type SessionCreateOutput = z.infer<typeof sessionCreateOutputSchema>
export type SessionSummary = z.infer<typeof sessionSummarySchema>
export type SessionListOutput = z.infer<typeof sessionListOutputSchema>
export type SessionPostOutput = z.infer<typeof sessionPostOutputSchema>
export type SessionEventsOutput = z.infer<typeof sessionEventsOutputSchema>
export type SessionLeaseView = z.infer<typeof sessionLeaseSchema>
export type SessionStatusOutput = z.infer<typeof sessionStatusOutputSchema>
export type AgentHostConfigOutput = z.infer<typeof agentHostConfigOutputSchema>
export type AgentHostModelAccessTokenOutput = z.infer<typeof agentHostModelAccessTokenOutputSchema>
export type AgentHostGithubTokenOutput = z.infer<typeof agentHostGithubTokenOutputSchema>
