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
  text: z.string().min(1).max(1_000_000),
})

export const sessionEventsInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  afterSeq: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  maxBytes: z.number().int().min(1).max(3_000_000).optional(),
})

export const sessionBlobInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  hash: z.string().min(1),
  offset: z.number().int().min(0).optional(),
  length: z.number().int().min(1).max(2_000_000).optional(),
})

export const sessionStatusInputSchema = z.strictObject({
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
export type SessionBlobInput = z.infer<typeof sessionBlobInputSchema>
export type SessionStatusInput = z.infer<typeof sessionStatusInputSchema>
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

export const sessionBlobOutputSchema = z.strictObject({
  size: z.number().int().min(0),
  offset: z.number().int().min(0),
  bytes: z.string(),
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
export type SessionBlobOutput = z.infer<typeof sessionBlobOutputSchema>
export type SessionLeaseView = z.infer<typeof sessionLeaseSchema>
export type SessionStatusOutput = z.infer<typeof sessionStatusOutputSchema>
export type AgentHostModelAccessTokenOutput = z.infer<typeof agentHostModelAccessTokenOutputSchema>
export type AgentHostGithubTokenOutput = z.infer<typeof agentHostGithubTokenOutputSchema>
