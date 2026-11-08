import {
  EMeterBasis,
  ESessionStatus,
  MAX_MESSAGE_UPLOADS,
  saidUploadSchema,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { sessionCommandRowSchema } from './command-row'
import { inboxMediaSchema, sessionPostMediaListSchema } from './media'

export const sessionCreateInputSchema = z.strictObject({
  projectId: z.string().min(1),
  title: z.string().optional(),
})

export const sessionListInputSchema = z.strictObject({
  projectId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

export const sessionPostInputSchema = z
  .strictObject({
    sessionId: z.string().min(1),
    text: z.string().max(1_000_000),
    media: sessionPostMediaListSchema.optional(),
    uploads: z.array(saidUploadSchema).max(MAX_MESSAGE_UPLOADS).optional(),
  })
  .refine(
    (input) =>
      input.text.trim().length > 0 ||
      (input.media?.length ?? 0) > 0 ||
      (input.uploads?.length ?? 0) > 0,
    'a message needs text or an attachment',
  )
  .refine(
    (input) => (input.media?.length ?? 0) + (input.uploads?.length ?? 0) <= MAX_MESSAGE_UPLOADS,
    `a message carries at most ${MAX_MESSAGE_UPLOADS} attachments`,
  )

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

export const sessionWithdrawInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  inboxId: z.number().int().min(1),
})

export const sessionArchiveInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  archived: z.boolean(),
})

export const sessionStatusInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export type SessionCreateInput = z.infer<typeof sessionCreateInputSchema>
export type SessionListInput = z.infer<typeof sessionListInputSchema>
export type SessionPostInput = z.infer<typeof sessionPostInputSchema>
export type SessionEventsInput = z.infer<typeof sessionEventsInputSchema>
export type SessionBlobInput = z.infer<typeof sessionBlobInputSchema>
export type SessionWithdrawInput = z.infer<typeof sessionWithdrawInputSchema>
export type SessionArchiveInput = z.infer<typeof sessionArchiveInputSchema>
export type SessionStatusInput = z.infer<typeof sessionStatusInputSchema>

export const inboxMessageSchema = z.strictObject({
  text: z.string(),
  media: z.array(inboxMediaSchema).optional(),
  uploads: z.array(saidUploadSchema).optional(),
})

export type InboxMessage = z.infer<typeof inboxMessageSchema>

export const INBOX_KIND_MESSAGE = 'message'

export const sessionCreateOutputSchema = z.strictObject({
  sessionId: z.string().min(1),
  mainThreadId: z.string().min(1),
})

export const sessionRowStatusSchema = z.strictObject({
  state: z.enum(ESessionStatus),
  reason: z.string().optional(),
  since: z.string().optional(),
})

export const prChecksSchema = z.strictObject({
  running: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
})

export const sessionRowPullRequestSchema = z.strictObject({
  repo: z.string().min(1),
  number: z.number().int().min(1),
  url: z.string().min(1),
  state: z.string().nullable(),
  checks: prChecksSchema.nullable(),
})

export const sessionSummarySchema = z.strictObject({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().nullable(),
  naming: z.boolean(),
  mainThreadId: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  archivedAt: z.string().nullable(),
  status: sessionRowStatusSchema.optional(),
  primaryBranch: z.string().nullable().optional(),
  pullRequest: sessionRowPullRequestSchema.nullable().optional(),
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
  holderHostId: z.number().int().nullable(),
  live: z.boolean(),
})

export const QUEUED_MESSAGES_LIMIT = 20

export const sessionQueuedMessageSchema = z.strictObject({
  inboxId: z.number().int().min(1),
  text: z.string(),
  postedAt: z.string().min(1),
  media: z.array(inboxMediaSchema).optional(),
  uploads: z.array(saidUploadSchema).optional(),
})

export const EWithdrawRefusal = {
  AlreadyConsumed: 'already-consumed',
  Unknown: 'unknown',
} as const

export const sessionWithdrawOutputSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum([EWithdrawRefusal.AlreadyConsumed, EWithdrawRefusal.Unknown]),
  }),
])

export const sessionArchiveOutputSchema = z.strictObject({ archivedAt: z.string().nullable() })

export const sessionStatusOutputSchema = z.strictObject({
  state: z.enum(ESessionStatus),
  reason: z.string().optional(),
  since: z.string().optional(),
  lease: sessionLeaseSchema,
  queued: z.array(sessionQueuedMessageSchema).optional(),
  commands: z.array(sessionCommandRowSchema).optional(),
})

export const sessionRetryInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export const sessionCommandInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  name: z.string().min(1),
  args: z.unknown(),
})

export const sessionViewInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export const sessionRetryOutputSchema = z.strictObject({ inboxId: z.number().int().min(1) })

export const sessionCommandOutputSchema = z.strictObject({
  inboxId: z.number().int().min(1).optional(),
})

const tokenSpendShape = {
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0),
  cacheWriteTokens: z.number().int().min(0),
}

export const sessionSpendRowSchema = z.strictObject({
  providerId: z.string(),
  modelId: z.string(),
  ...tokenSpendShape,
})

export const sessionSpendTallySchema = z.strictObject({
  ...tokenSpendShape,
  uncachedInputTokens: z.number().int(),
  costUsd: z.number().nullable(),
})

export const sessionContextMeterSchema = z.strictObject({
  used: z.number().min(0),
  window: z.number().nullable(),
  basis: z.enum(EMeterBasis),
  measuredThroughSeq: z.number().int().nullable(),
  estimatedTokens: z.number().min(0),
})

export const sessionCheckoutsSchema = z.strictObject({
  repos: z.array(
    z.strictObject({
      repo: z.string(),
      base: z.string().nullable(),
      head: z.string().nullable(),
      branches: z.array(
        z.strictObject({
          name: z.string(),
          sha: z.string(),
          worktreePath: z.string().nullable(),
        }),
      ),
    }),
  ),
  primary: z.strictObject({ repo: z.string(), branch: z.string() }).nullable(),
})

export const sessionPullRequestStateSchema = z.strictObject({
  title: z.string(),
  state: z.string(),
  headSha: z.string(),
  checks: prChecksSchema,
  mergeable: z.boolean().nullable(),
  updatedAt: z.string(),
})

export const sessionLinkedPullRequestSchema = z.strictObject({
  repo: z.string().min(1),
  number: z.number().int().min(1),
  url: z.string().min(1),
  branch: z.string(),
  state: sessionPullRequestStateSchema.nullable(),
})

export const sessionViewOutputSchema = z.strictObject({
  at: z.number().int().min(0),
  status: sessionStatusOutputSchema,
  context: sessionContextMeterSchema.nullable(),
  spend: z.strictObject({
    rows: z.array(sessionSpendRowSchema),
    tally: sessionSpendTallySchema,
  }),
  checkouts: sessionCheckoutsSchema,
  pullRequests: z.array(sessionLinkedPullRequestSchema),
})

export type SessionRetryInput = z.infer<typeof sessionRetryInputSchema>
export type SessionRetryOutput = z.infer<typeof sessionRetryOutputSchema>
export type SessionCommandInput = z.infer<typeof sessionCommandInputSchema>
export type SessionCommandOutput = z.infer<typeof sessionCommandOutputSchema>
export type SessionViewInput = z.infer<typeof sessionViewInputSchema>
export type SessionViewOutput = z.infer<typeof sessionViewOutputSchema>
export type SessionCreateOutput = z.infer<typeof sessionCreateOutputSchema>
export type SessionSummary = z.infer<typeof sessionSummarySchema>
export type SessionListOutput = z.infer<typeof sessionListOutputSchema>
export type SessionPostOutput = z.infer<typeof sessionPostOutputSchema>
export type SessionEventsOutput = z.infer<typeof sessionEventsOutputSchema>
export type SessionBlobOutput = z.infer<typeof sessionBlobOutputSchema>
export type SessionLeaseView = z.infer<typeof sessionLeaseSchema>
export type SessionQueuedMessage = z.infer<typeof sessionQueuedMessageSchema>
export type SessionWithdrawOutput = z.infer<typeof sessionWithdrawOutputSchema>
export type SessionArchiveOutput = z.infer<typeof sessionArchiveOutputSchema>
export type SessionStatusOutput = z.infer<typeof sessionStatusOutputSchema>
