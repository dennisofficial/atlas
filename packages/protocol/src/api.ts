import { EV2SessionState } from '@dltech/atlas-core'
import { z } from 'zod'

export const v2SessionCreateInputSchema = z.strictObject({
  projectId: z.string().min(1),
  title: z.string().optional(),
})

export const v2SessionListInputSchema = z.strictObject({
  projectId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

export const v2SessionPostInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  text: z.string().min(1),
})

export const v2SessionEventsInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  afterSeq: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
})

export const v2SessionStatusInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export const v2AgentHostConfigInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export const v2AgentHostModelAccessTokenInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  connectionId: z.string().min(1),
  rejectedAccessToken: z.string().optional(),
})

export const v2AgentHostGithubTokenInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export type V2SessionCreateInput = z.infer<typeof v2SessionCreateInputSchema>
export type V2SessionListInput = z.infer<typeof v2SessionListInputSchema>
export type V2SessionPostInput = z.infer<typeof v2SessionPostInputSchema>
export type V2SessionEventsInput = z.infer<typeof v2SessionEventsInputSchema>
export type V2SessionStatusInput = z.infer<typeof v2SessionStatusInputSchema>
export type V2AgentHostConfigInput = z.infer<typeof v2AgentHostConfigInputSchema>
export type V2AgentHostModelAccessTokenInput = z.infer<
  typeof v2AgentHostModelAccessTokenInputSchema
>
export type V2AgentHostGithubTokenInput = z.infer<typeof v2AgentHostGithubTokenInputSchema>

export const v2InboxMessageSchema = z.strictObject({ text: z.string().min(1) })

export type V2InboxMessage = z.infer<typeof v2InboxMessageSchema>

export const V2_INBOX_KIND_MESSAGE = 'message'

export const v2SessionCreateOutputSchema = z.strictObject({
  sessionId: z.string().min(1),
  mainThreadId: z.string().min(1),
})

export const v2SessionSummarySchema = z.strictObject({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().nullable(),
  mainThreadId: z.string().min(1),
  createdAt: z.string().min(1),
})

export const v2SessionListOutputSchema = z.strictObject({
  sessions: z.array(v2SessionSummarySchema),
})

export const v2SessionPostOutputSchema = z.strictObject({ inboxId: z.number().int().min(1) })

export const v2SessionEventsOutputSchema = z.strictObject({
  events: z.array(z.record(z.string(), z.unknown())),
  next: z.number().int().min(1).optional(),
})

export const v2SessionLeaseSchema = z.strictObject({
  epoch: z.number().int().min(0),
  holderId: z.string().nullable(),
  live: z.boolean(),
})

export const v2SessionStatusOutputSchema = z.strictObject({
  state: z.enum(EV2SessionState),
  reason: z.string().optional(),
  since: z.string().optional(),
  lease: v2SessionLeaseSchema,
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

export const v2AgentHostConfigOutputSchema = z.strictObject({
  userId: z.string().min(1),
  projectId: z.string().min(1),
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

export const v2AgentHostModelAccessTokenOutputSchema = z.strictObject({
  accessToken: z.string().min(1),
  expiresAt: z.string().min(1),
  refreshAfter: z.string().min(1),
  generation: z.number().int().min(0),
  authorizationId: z.string().min(1),
  providerAccountId: z.string().optional(),
})

export const v2AgentHostGithubTokenOutputSchema = z.strictObject({
  token: z.string().min(1).nullable(),
})

export type V2SessionCreateOutput = z.infer<typeof v2SessionCreateOutputSchema>
export type V2SessionSummary = z.infer<typeof v2SessionSummarySchema>
export type V2SessionListOutput = z.infer<typeof v2SessionListOutputSchema>
export type V2SessionPostOutput = z.infer<typeof v2SessionPostOutputSchema>
export type V2SessionEventsOutput = z.infer<typeof v2SessionEventsOutputSchema>
export type V2SessionLeaseView = z.infer<typeof v2SessionLeaseSchema>
export type V2SessionStatusOutput = z.infer<typeof v2SessionStatusOutputSchema>
export type V2AgentHostConfigOutput = z.infer<typeof v2AgentHostConfigOutputSchema>
export type V2AgentHostModelAccessTokenOutput = z.infer<
  typeof v2AgentHostModelAccessTokenOutputSchema
>
export type V2AgentHostGithubTokenOutput = z.infer<typeof v2AgentHostGithubTokenOutputSchema>
