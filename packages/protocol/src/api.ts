import { ESessionStatus, MAX_MESSAGE_UPLOADS, saidUploadSchema } from '@dltech/atlas-core'
import { z } from 'zod'

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

export const sessionSummarySchema = z.strictObject({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().nullable(),
  naming: z.boolean(),
  mainThreadId: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  archivedAt: z.string().nullable(),
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
})

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
