import { z } from 'zod'

import {
  agentSnapshotWireSchema,
  serviceSnapshotWireSchema,
  shellIdWireSchema,
  shellSnapshotWireSchema,
} from './roster-wire'
import { wireEventSchema, wireThreadSchema, wireTurnSchema } from './session-wire'

export const threadIdWireSchema = z.string().min(1).brand<'ThreadId'>()

export const seqSchema = z.number().int().nonnegative()

export const readEventsParamsSchema = z.object({
  threadId: threadIdWireSchema,
  fromSeq: seqSchema.optional(),
  upTo: seqSchema.optional(),
  own: z.boolean().optional(),
})
export type ReadEventsParams = z.infer<typeof readEventsParamsSchema>

export const readTranscriptIdentityParamsSchema = z.object({
  threadId: threadIdWireSchema,
  upTo: seqSchema.optional(),
})
export type ReadTranscriptIdentityParams = z.infer<typeof readTranscriptIdentityParamsSchema>

export const readThreadParamsSchema = z.object({
  threadId: threadIdWireSchema,
})
export type ReadThreadParams = z.infer<typeof readThreadParamsSchema>

export const readTurnsParamsSchema = z.object({ threadId: threadIdWireSchema })
export type ReadTurnsParams = z.infer<typeof readTurnsParamsSchema>

export const renameThreadParamsSchema = z.object({
  threadId: threadIdWireSchema,
  title: z.string(),
})
export type RenameThreadParams = z.infer<typeof renameThreadParamsSchema>

export const takeBackPendingParamsSchema = z.object({
  threadId: threadIdWireSchema,
})
export type TakeBackPendingParams = z.infer<typeof takeBackPendingParamsSchema>

export const provideOperatorInputParamsSchema = z.strictObject({
  requestId: z.string().min(1),
  value: z.string(),
})
export type ProvideOperatorInputParams = z.infer<typeof provideOperatorInputParamsSchema>

export const operatorInputReplySchema = z.strictObject({
  delivered: z.boolean(),
  bytes: z.number().int().nonnegative(),
})
export type OperatorInputReply = z.infer<typeof operatorInputReplySchema>

export const resumeAgentParamsSchema = z.object({
  threadId: threadIdWireSchema,
  agentId: threadIdWireSchema,
})
export type ResumeAgentParams = z.infer<typeof resumeAgentParamsSchema>

export const stopAgentParamsSchema = z.object({
  threadId: threadIdWireSchema,
  agentId: threadIdWireSchema,
})
export type StopAgentParams = z.infer<typeof stopAgentParamsSchema>

/** The harness registry's AgentOutcome, mirrored so the wire package never imports in-repo code. */
export const agentOutcomeWireSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), snapshot: agentSnapshotWireSchema }),
  z.object({ ok: z.literal(false), reason: z.string() }),
])
export type AgentOutcomeWire = z.infer<typeof agentOutcomeWireSchema>

export const startShellParamsSchema = z.object({
  threadId: threadIdWireSchema,
  command: z.string().min(1),
  description: z.string().min(1),
  cwd: z.string().min(1).optional(),
})
export type StartShellParams = z.infer<typeof startShellParamsSchema>

export const readShellOutputParamsSchema = z.object({
  threadId: threadIdWireSchema,
  shellId: shellIdWireSchema,
  characters: z.number().int().positive(),
})
export type ReadShellOutputParams = z.infer<typeof readShellOutputParamsSchema>

export const killShellParamsSchema = z.object({
  threadId: threadIdWireSchema,
  shellId: shellIdWireSchema,
})
export type KillShellParams = z.infer<typeof killShellParamsSchema>

export const stopServiceParamsSchema = z.object({
  serviceId: z.string().min(1),
})
export type StopServiceParams = z.infer<typeof stopServiceParamsSchema>

export const readServiceLogParamsSchema = z.object({
  serviceId: z.string().min(1),
  characters: z.number().int().positive(),
})
export type ReadServiceLogParams = z.infer<typeof readServiceLogParamsSchema>

export const startedShellReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), snapshot: shellSnapshotWireSchema }),
  z.object({ ok: z.literal(false), reason: z.string() }),
])
export type StartedShellReply = z.infer<typeof startedShellReplySchema>

export const shellOutputReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), text: z.string() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
])
export type ShellOutputReply = z.infer<typeof shellOutputReplySchema>

export const killShellReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), snapshot: shellSnapshotWireSchema }),
  z.object({ ok: z.literal(false), reason: z.string() }),
])
export type KillShellReply = z.infer<typeof killShellReplySchema>

export const stopServiceReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), snapshot: serviceSnapshotWireSchema }),
  z.object({ ok: z.literal(false), reason: z.string() }),
])
export type StopServiceReply = z.infer<typeof stopServiceReplySchema>

export const serviceLogReplySchema = z.object({ text: z.string() })
export type ServiceLogReply = z.infer<typeof serviceLogReplySchema>

export const threadModelWireSchema = z.object({
  ref: z.string(),
  effort: z.string(),
})

export const setThreadModelParamsSchema = z.object({
  threadId: threadIdWireSchema,
  model: threadModelWireSchema,
  retarget: z.boolean().optional(),
})
export type SetThreadModelParams = z.infer<typeof setThreadModelParamsSchema>

export const listContextFilesParamsSchema = z.object({
  directory: z.string().optional(),
})
export type ListContextFilesParams = z.infer<typeof listContextFilesParamsSchema>

export const readContextFileParamsSchema = z.object({ path: z.string() })
export type ReadContextFileParams = z.infer<typeof readContextFileParamsSchema>

const directoryEntryWireSchema = z.object({
  name: z.string(),
  isDirectory: z.boolean(),
})

export const contextFileContentWireSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    content: z.string(),
    truncated: z.boolean(),
  }),
  z.object({
    type: z.literal('image'),
    data: z.string(),
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  }),
  z.object({ type: z.literal('refused'), reason: z.string() }),
])
export type ContextFileContentWire = z.infer<typeof contextFileContentWireSchema>

export const listContextFilesReplySchema = z.object({
  entries: z.array(directoryEntryWireSchema),
})
export const readContextFileReplySchema = z.object({
  file: contextFileContentWireSchema,
})

export const readEventsReplySchema = z.object({
  events: z.array(wireEventSchema),
})
export const readThreadReplySchema = z.object({
  thread: wireThreadSchema.nullable(),
})
export const readThreadsReplySchema = z.object({
  threads: z.array(wireThreadSchema),
})
export const transcriptIdentityReplySchema = z.object({
  count: z.number().int().nonnegative(),
  digest: z.string(),
})
export const readTurnsReplySchema = z.object({
  own: z.array(wireTurnSchema),
  delegated: z.array(wireTurnSchema),
})

export const publishedWorkspaceWireSchema = z
  .object({
    ref: z.string(),
    commit: z.string(),
    base: z.string().nullable(),
    /** Absent on a serve built before baseTree existed; the host falls back to the base commit. */
    baseTree: z.string().nullish(),
    branch: z.string().nullish(),
  })
  .nullable()

export type PublishedWorkspaceWire = z.infer<typeof publishedWorkspaceWireSchema>
