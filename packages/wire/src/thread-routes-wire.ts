import { z } from 'zod'

import { podEventsPostSchema } from './pod-events-wire'
import {
  createThreadReplySchema,
  wireEventSchema,
  wireThreadSchema,
  wireTurnSchema,
} from './session-wire'
import { threadMessageRequestSchema } from './thread-message-wire'

export const threadIdInputSchema = z.object({ threadId: z.string().min(1) })
export type ThreadIdInput = z.infer<typeof threadIdInputSchema>

export const eventDraftSchema = z.object({
  type: z.string().min(1),
  body: z.string(),
  contextSlot: z.string().optional(),
  contextKey: z.string().optional(),
  contextDigest: z.string().optional(),
})
export type EventDraftInput = z.infer<typeof eventDraftSchema>

export const supervisedAgentSchema = z.object({
  spawnedBy: z.string().min(1),
  type: z.string().min(1),
})
export type SupervisedAgentInput = z.infer<typeof supervisedAgentSchema>

export const createThreadInputSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().optional(),
  workspace: z.string().optional(),
  repo: z.string().nullable().optional(),
  projectId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
  firstMessage: threadMessageRequestSchema.optional(),
  agent: supervisedAgentSchema.optional(),
})
export type CreateThreadInput = z.infer<typeof createThreadInputSchema>

export const createThreadOutputSchema = z.union([wireThreadSchema, createThreadReplySchema])

export const openThreadInputSchema = z.object({
  id: z.string().min(1).optional(),
  runId: z.string().min(1),
  drafts: z.array(eventDraftSchema),
  title: z.string().optional(),
  workspace: z.string().optional(),
  repo: z.string().nullable().optional(),
  projectId: z.string().min(1).optional(),
  executionLocation: z.string().optional(),
  agent: supervisedAgentSchema.optional(),
})
export type OpenThreadInput = z.infer<typeof openThreadInputSchema>

export const openThreadReplySchema = z.object({
  thread: wireThreadSchema,
  events: z.array(wireEventSchema),
})
export type OpenThreadReply = z.infer<typeof openThreadReplySchema>

export const recentThreadInputSchema = z.object({ project: z.string().min(1) })
export type RecentThreadInput = z.infer<typeof recentThreadInputSchema>

const isoTimestampSchema = z.union([z.iso.datetime({ offset: true, local: true }), z.iso.date()])

const isPresent = (value: string | undefined): boolean => value !== undefined && value.length > 0

export const listThreadsInputSchema = z
  .object({
    project: z.string().optional(),
    projectId: z.string().optional(),
    limit: z.number().int().min(1).optional(),
  })
  .refine((input) => isPresent(input.project) !== isPresent(input.projectId), {
    message: 'exactly one of project or projectId is required',
  })
export type ListThreadsInput = z.infer<typeof listThreadsInputSchema>

export const renameThreadInputSchema = threadIdInputSchema.extend({ title: z.string() })
export type RenameThreadInput = z.infer<typeof renameThreadInputSchema>

export const archiveThreadInputSchema = threadIdInputSchema.extend({ archived: z.boolean() })
export type ArchiveThreadInput = z.infer<typeof archiveThreadInputSchema>

export const markThreadReadInputSchema = z.strictObject({
  threadId: z.string().min(1),
  seq: z.number().int().min(0),
})
export type MarkThreadReadInput = z.infer<typeof markThreadReadInputSchema>

export const chooseThreadModelInputSchema = threadIdInputSchema.extend({
  ref: z.string().min(1),
  effort: z.string().min(1),
})
export type ChooseThreadModelInput = z.infer<typeof chooseThreadModelInputSchema>

export const adoptThreadInputSchema = threadIdInputSchema.extend({
  workspace: z.string().min(1),
  repo: z.string().nullable().optional(),
})
export type AdoptThreadInput = z.infer<typeof adoptThreadInputSchema>

export const rewindThreadInputSchema = threadIdInputSchema.extend({
  toSeq: z.number().int().min(0),
  cutAgents: z.array(z.string()).optional(),
})
export type RewindThreadInput = z.infer<typeof rewindThreadInputSchema>

export const compactThreadInputSchema = threadIdInputSchema.extend({
  anchor: z.enum(['prefix', 'suffix']),
  fromSeq: z.number().int().min(0),
  throughSeq: z.number().int().min(0),
  summary: z.string(),
})
export type CompactThreadInput = z.infer<typeof compactThreadInputSchema>

export const summariseThreadInputSchema = compactThreadInputSchema.extend({
  cutAgents: z.array(z.string()).optional(),
})
export type SummariseThreadInput = z.infer<typeof summariseThreadInputSchema>

export const replacedReplySchema = z.object({ replaced: z.number().int() })
export type ReplacedReply = z.infer<typeof replacedReplySchema>

export const forkThreadInputSchema = threadIdInputSchema.extend({
  seq: z.number().int().min(0),
  mode: z.enum(['reference', 'copy']),
  title: z.string().optional(),
})
export type ForkThreadInput = z.infer<typeof forkThreadInputSchema>

export const appendEventsInputSchema = threadIdInputSchema.extend({
  runId: z.string().min(1),
  parentRunId: z.string().optional(),
  depth: z.number().int().min(0).optional(),
  drafts: z.array(eventDraftSchema).min(1),
})
export type AppendEventsInput = z.infer<typeof appendEventsInputSchema>

export const replaceEventsInputSchema = threadIdInputSchema.extend({
  runId: z.string().min(1),
  drafts: z.array(eventDraftSchema),
})
export type ReplaceEventsInput = z.infer<typeof replaceEventsInputSchema>

export const readEventsInputSchema = threadIdInputSchema.extend({
  upTo: z.number().int().min(0).optional(),
  own: z.boolean().optional(),
})
export type ReadEventsInput = z.infer<typeof readEventsInputSchema>

export const importEventsInputSchema = podEventsPostSchema.extend({ threadId: z.string().min(1) })
export type ImportEventsInput = z.infer<typeof importEventsInputSchema>

export const threadHeadReplySchema = z.object({ head: z.number().int() })
export type ThreadHeadReply = z.infer<typeof threadHeadReplySchema>

export const recordTurnInputSchema = threadIdInputSchema.extend({
  runId: z.string().min(1),
  status: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  steps: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0),
  cacheWriteTokens: z.number().int().min(0),
  startedAt: isoTimestampSchema,
  endedAt: isoTimestampSchema,
  durationMs: z.number().int().min(0),
})
export type RecordTurnInput = z.infer<typeof recordTurnInputSchema>

export const turnTreeSchema = z.object({
  own: z.array(wireTurnSchema),
  delegated: z.array(wireTurnSchema),
})
export type TurnTree = z.infer<typeof turnTreeSchema>

export const threadMessageSendInputSchema = threadMessageRequestSchema.extend({
  threadId: z.string().min(1),
})
export type ThreadMessageSendInput = z.infer<typeof threadMessageSendInputSchema>

export const threadMessageTakeBackInputSchema = threadIdInputSchema.extend({
  sendId: z.string().min(1),
})
export type ThreadMessageTakeBackInput = z.infer<typeof threadMessageTakeBackInputSchema>

export enum EThreadStreamFrame {
  Head = 'head',
  Pod = 'pod',
  Heartbeat = 'heartbeat',
}

export const threadStreamFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal(EThreadStreamFrame.Head), head: z.number().int() }),
  z.object({ type: z.literal(EThreadStreamFrame.Pod) }),
  z.object({ type: z.literal(EThreadStreamFrame.Heartbeat) }),
])
export type ThreadStreamFrame = z.infer<typeof threadStreamFrameSchema>

const isAsyncIterable = (value: unknown): value is AsyncIterable<ThreadStreamFrame> =>
  typeof value === 'object' && value !== null && Symbol.asyncIterator in value

export const threadStreamOutputSchema = z.custom<AsyncIterable<ThreadStreamFrame>>(isAsyncIterable)

export const threadStreamInputSchema = z.strictObject({ threadId: z.string().min(1) })
export type ThreadStreamInput = z.infer<typeof threadStreamInputSchema>
