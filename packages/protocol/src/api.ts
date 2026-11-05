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

export const MAX_REPAIR_SOURCE_CHARS = 200_000
export const MAX_REPAIR_ERROR_CHARS = 20_000

export const sessionRepairDiagramInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  source: z.string().min(1).max(MAX_REPAIR_SOURCE_CHARS),
  error: z.string().max(MAX_REPAIR_ERROR_CHARS),
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

export type SessionCreateInput = z.infer<typeof sessionCreateInputSchema>
export type SessionListInput = z.infer<typeof sessionListInputSchema>
export type SessionPostInput = z.infer<typeof sessionPostInputSchema>
export type SessionRepairDiagramInput = z.infer<typeof sessionRepairDiagramInputSchema>
export type SessionEventsInput = z.infer<typeof sessionEventsInputSchema>
export type SessionBlobInput = z.infer<typeof sessionBlobInputSchema>
export type SessionStatusInput = z.infer<typeof sessionStatusInputSchema>

export const inboxMessageSchema = z.strictObject({ text: z.string().min(1) })

export type InboxMessage = z.infer<typeof inboxMessageSchema>

export const INBOX_KIND_MESSAGE = 'message'

export const inboxRepairDiagramSchema = z.strictObject({
  messageId: z.string().min(1),
  source: z.string().min(1).max(MAX_REPAIR_SOURCE_CHARS),
  error: z.string().max(MAX_REPAIR_ERROR_CHARS),
})

export type InboxRepairDiagram = z.infer<typeof inboxRepairDiagramSchema>

export const INBOX_KIND_REPAIR_DIAGRAM = 'repair-diagram'

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
  holderHostId: z.number().int().nullable(),
  live: z.boolean(),
})

export const sessionStatusOutputSchema = z.strictObject({
  state: z.enum(ESessionStatus),
  reason: z.string().optional(),
  since: z.string().optional(),
  lease: sessionLeaseSchema,
})

export type SessionCreateOutput = z.infer<typeof sessionCreateOutputSchema>
export type SessionSummary = z.infer<typeof sessionSummarySchema>
export type SessionListOutput = z.infer<typeof sessionListOutputSchema>
export type SessionPostOutput = z.infer<typeof sessionPostOutputSchema>
export type SessionEventsOutput = z.infer<typeof sessionEventsOutputSchema>
export type SessionBlobOutput = z.infer<typeof sessionBlobOutputSchema>
export type SessionLeaseView = z.infer<typeof sessionLeaseSchema>
export type SessionStatusOutput = z.infer<typeof sessionStatusOutputSchema>
