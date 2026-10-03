import { z } from 'zod'

import { agentSnapshotWireSchema } from './roster-wire.js'
import { wireEventSchema, wireThreadSchema, wireTurnSchema } from './session-wire.js'

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

export const readThreadParamsSchema = z.object({ threadId: threadIdWireSchema })
export type ReadThreadParams = z.infer<typeof readThreadParamsSchema>

export const readTurnsParamsSchema = z.object({ threadId: threadIdWireSchema })
export type ReadTurnsParams = z.infer<typeof readTurnsParamsSchema>

export const renameThreadParamsSchema = z.object({
  threadId: threadIdWireSchema,
  title: z.string(),
})
export type RenameThreadParams = z.infer<typeof renameThreadParamsSchema>

export const takeBackPendingParamsSchema = z.object({ threadId: threadIdWireSchema })
export type TakeBackPendingParams = z.infer<typeof takeBackPendingParamsSchema>

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

export const threadModelWireSchema = z.object({ ref: z.string(), effort: z.string() })

export const setThreadModelParamsSchema = z.object({
  threadId: threadIdWireSchema,
  model: threadModelWireSchema,
  retarget: z.boolean().optional(),
})
export type SetThreadModelParams = z.infer<typeof setThreadModelParamsSchema>

/**
 * The lift's `location-changed` marker, carried on the restore op so the sandbox pins it on its own
 * log as part of the restore. The values mirror core's EExecutionLocation, which wire cannot import.
 */
export const restoreTranscriptParamsSchema = z.object({
  locationChanged: z
    .object({
      from: z.enum(['host', 'docker', 'cloud']),
      to: z.enum(['host', 'docker', 'cloud']),
      cwd: z.string().min(1).optional(),
      remoteUrl: z.string().min(1).nullable().optional(),
      branch: z.string().min(1).nullable().optional(),
    })
    .optional(),
})
export type RestoreTranscriptParams = z.infer<typeof restoreTranscriptParamsSchema>

export const readEventsReplySchema = z.object({ events: z.array(wireEventSchema) })
export const readThreadReplySchema = z.object({ thread: wireThreadSchema.nullable() })
export const readThreadsReplySchema = z.object({ threads: z.array(wireThreadSchema) })
export const transcriptIdentityReplySchema = z.object({
  count: z.number().int().nonnegative(),
  digest: z.string(),
})
export const readTurnsReplySchema = z.object({
  own: z.array(wireTurnSchema),
  delegated: z.array(wireTurnSchema),
})

/** The whole session directory as a base64 tar.gz — the descend's transcript transfer. */
export const readSessionArchiveReplySchema = z.object({ archive: z.string() })

/** The sandbox's memory roots as a base64 tar.gz — '' when the sandbox holds none. */
export const readMemoryArchiveReplySchema = z.object({ archive: z.string() })

export const publishedWorkspaceWireSchema = z
  .object({
    ref: z.string(),
    commit: z.string(),
    base: z.string().nullable(),
    /** Absent on a serve built before the tree-merge descend; the host falls back to the base commit. */
    baseTree: z.string().nullish(),
    branch: z.string().nullish(),
  })
  .nullable()

export type PublishedWorkspaceWire = z.infer<typeof publishedWorkspaceWireSchema>
