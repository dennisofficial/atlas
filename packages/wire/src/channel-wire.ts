import { z } from 'zod'

import { rosterWireSchema } from './roster-wire.js'
import { runtimeCheckpointSchema } from './runtime-checkpoint.js'
import { wireEventSchema, wireThreadSchema, wireTurnSchema } from './session-wire.js'
import { channelSignalSchema } from './signal-wire.js'

export const CHANNEL_SUBPROTOCOL = 'atlas.v1'

/**
 * Bumped by hand when a frame's shape changes. The TUI and the serve are built at different times
 * from different releases — the TUI from the operator's build, the serve from whatever the API's
 * deploy last downloaded into the sandbox — so each side stamps its own copy onto the hello and
 * the ready, and a mismatch refuses legibly instead of failing on the first changed frame.
 */
export const CHANNEL_PROTOCOL_VERSION = 10

const BEARER_SUBPROTOCOL_PREFIX = 'bearer.'

export const bearerSubprotocolOf = (token: string): string =>
  `${BEARER_SUBPROTOCOL_PREFIX}${token}`

export const tokenFromSubprotocols = (protocols: readonly string[]): string | null => {
  const carrier = protocols.find((protocol) => protocol.startsWith(BEARER_SUBPROTOCOL_PREFIX))
  if (carrier === undefined) return null

  const token = carrier.slice(BEARER_SUBPROTOCOL_PREFIX.length)
  return token.length === 0 ? null : token
}

export enum EServeFrame {
  Ready = 'ready',
  Signal = 'signal',
  Reply = 'reply',
  Reload = 'reload',
  Parked = 'parked',
  TurnEnded = 'turn-ended',
  InterruptAcked = 'interrupt-acked',
  SendAcked = 'send-acked',
  Roster = 'roster',
  Checkpoint = 'checkpoint',
  ThreadRenamed = 'thread-renamed',
  ThreadModelChanged = 'thread-model-changed',
  Error = 'error',
}

export enum EClientFrame {
  Hello = 'hello',
  Send = 'send',
  Run = 'run',
  Interrupt = 'interrupt',
  Pause = 'pause',
  Resume = 'resume',
  Request = 'request',
  Pong = 'pong',
}

export enum EClientRequest {
  CompletePaths = 'complete-paths',
  BrowseDirectory = 'browse-directory',
  PublishWorkspace = 'publish-workspace',
  /**
   * The live shell/agent/service rosters, for a client whose footer and sidebar read local
   * registries the sandbox never populates. A serve built before this op refuses the request, and
   * the client reads that as an empty roster rather than an error.
   */
  ListRoster = 'list-roster',
  /**
   * A confirmed rewind's cleanup: the sandbox destroys the named creations from its own registries
   * and stops the turn it is driving, so a mid-turn loop never acts on pre-rewind state. The
   * durable truncation already landed over HTTP before this op is sent; a serve built before it
   * refuses, and the client proceeds with the remote processes left running.
   */
  Rewind = 'rewind',
  /**
   * Transcript reads against the session the sandbox is serving, answered from its on-disk JSONL
   * stores. A serve built before the transcript moved off the control plane refuses them; a client
   * that cannot fall back to the HTTP log (there is none anymore) must not be paired with one.
   */
  ReadEvents = 'read-events',
  ReadThread = 'read-thread',
  ReadThreads = 'read-threads',
  ReadTurns = 'read-turns',
  ReadSessionArchive = 'read-session-archive',
  ReadTranscriptIdentity = 'read-transcript-identity',
  /**
   * The descend's memory transfer: the sandbox's user and project memory, tarred under the same
   * `.atlas/memory/…` and `project-memory/…` keys the lift archive carried them by. Never a
   * standing store — the host merges per-file by mtime, so a serve that cannot answer (or a
   * sandbox that never saw memory) must be read as an empty archive, not an error.
   */
  ReadMemoryArchive = 'read-memory-archive',
  /**
   * Transcript mutations against the session the sandbox is serving, applied to its on-disk JSONL
   * stores and announced back over the wire. A serve built before these ops answers with a protocol
   * error, and the client falls back to its local store.
   */
  RenameThread = 'rename-thread',
  SetThreadModel = 'set-thread-model',
  /**
   * The lift's late transcript restore: the archive the laptop shipped to the drive is extracted
   * into the session directory and the store re-read, so a transcript uploaded after serve was
   * already healthy reaches the session without a process restart. A serve built before this op
   * refuses, and the lift warns rather than silently attaching a blank transcript.
   */
  RestoreTranscript = 'restore-transcript',
  ReadRuntimeCheckpoint = 'read-runtime-checkpoint',
}

export enum ETurnStatus {
  Completed = 'completed',
  Paused = 'paused',
  Idle = 'idle',
  Interrupted = 'interrupted',
  RelocationPaused = 'relocation-paused',
  Failed = 'failed',
}

const runIdWireSchema = z.string().min(1).brand<'RunId'>()
const callIdWireSchema = z.string().min(1).brand<'CallId'>()
const threadIdWireSchema = z.string().min(1).brand<'ThreadId'>()
const sendIdWireSchema = z.string().min(1).brand<'SendId'>()

export type SendId = z.infer<typeof sendIdWireSchema>

/** The client assigns each send a correlation id so a re-driven frame is recognized, not re-committed. */
export const toSendId = (value: string): SendId => sendIdWireSchema.parse(value)

const seqSchema = z.number().int().nonnegative()

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

export const turnOutcomeWireSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal(ETurnStatus.Completed), runId: runIdWireSchema }),
  z.object({
    status: z.literal(ETurnStatus.Paused),
    runId: runIdWireSchema,
    callId: callIdWireSchema,
    reason: z.string(),
  }),
  z.object({ status: z.literal(ETurnStatus.Idle), runId: runIdWireSchema }),
  z.object({
    status: z.literal(ETurnStatus.Interrupted),
    runId: runIdWireSchema,
    committed: z.boolean(),
  }),
  z.object({
    status: z.literal(ETurnStatus.RelocationPaused),
    runId: runIdWireSchema,
  }),
  z.object({
    status: z.literal(ETurnStatus.Failed),
    runId: runIdWireSchema,
    message: z.string(),
  }),
])

export type TurnOutcomeWire = z.infer<typeof turnOutcomeWireSchema>

const saidImageWireSchema = z.object({
  path: z.string(),
  mediaType: z.string(),
  data: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export type SaidImageWire = z.infer<typeof saidImageWireSchema>

const saidFileWireSchema = z.object({
  path: z.string(),
  mediaType: z.string(),
  data: z.string(),
  filename: z.string().optional(),
})

export type SaidFileWire = z.infer<typeof saidFileWireSchema>

export const serveFrameSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(EServeFrame.Ready),
    seq: seqSchema,
    protocol: z.number().int().nonnegative().optional(),
    /**
     * Absent on a serve built before this field existed; a client must treat that as `false`,
     * which reproduces the old fail-fast behaviour against an old serve rather than hanging.
     */
    turnInFlight: z.boolean().optional(),
    checkpoint: runtimeCheckpointSchema.nullable().catch(null).optional(),
  }),
  z.object({ kind: z.literal(EServeFrame.Signal), seq: seqSchema, signal: channelSignalSchema }),
  z.object({
    kind: z.literal(EServeFrame.Reply),
    replyTo: z.string().min(1),
    ok: z.boolean(),
    data: z.unknown(),
  }),
  z.object({ kind: z.literal(EServeFrame.Reload), sinceEventSeq: seqSchema }),
  z.object({ kind: z.literal(EServeFrame.Parked), reason: z.string(), checkpoint: runtimeCheckpointSchema.nullable().catch(null).optional() }),
  z.object({ kind: z.literal(EServeFrame.Checkpoint), checkpoint: runtimeCheckpointSchema }),
  z.object({ kind: z.literal(EServeFrame.TurnEnded), outcome: turnOutcomeWireSchema }),
  z.object({ kind: z.literal(EServeFrame.InterruptAcked), seq: seqSchema }),
  z.object({ kind: z.literal(EServeFrame.SendAcked), sendId: sendIdWireSchema }),
  z.object({ kind: z.literal(EServeFrame.Roster), roster: rosterWireSchema }),
  z.object({
    kind: z.literal(EServeFrame.ThreadRenamed),
    threadId: threadIdWireSchema,
    title: z.string(),
  }),
  z.object({
    kind: z.literal(EServeFrame.ThreadModelChanged),
    threadId: threadIdWireSchema,
    model: threadModelWireSchema,
  }),
  z.object({ kind: z.literal(EServeFrame.Error), message: z.string() }),
])

export type ServeFrame = z.infer<typeof serveFrameSchema>

export const clientFrameSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(EClientFrame.Hello),
    threadId: threadIdWireSchema,
    channelCursor: seqSchema.nullable(),
    lastEventSeq: seqSchema,
    protocol: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal(EClientFrame.Send),
    sendId: sendIdWireSchema,
    text: z.string(),
    images: z.array(saidImageWireSchema).readonly().optional(),
    files: z.array(saidFileWireSchema).readonly().optional(),
    context: z.array(z.unknown()).readonly().optional(),
  }),
  z.object({ kind: z.literal(EClientFrame.Run) }),
  z.object({ kind: z.literal(EClientFrame.Interrupt) }),
  z.object({ kind: z.literal(EClientFrame.Pause) }),
  z.object({ kind: z.literal(EClientFrame.Resume) }),
  z.object({
    kind: z.literal(EClientFrame.Request),
    id: z.string().min(1),
    op: z.nativeEnum(EClientRequest),
    params: z.unknown(),
  }),
  z.object({ kind: z.literal(EClientFrame.Pong) }),
])

export type ClientFrame = z.infer<typeof clientFrameSchema>

export const encodeFrame = (frame: ServeFrame | ClientFrame): string => JSON.stringify(frame)

const parsedJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export const decodeServeFrame = (raw: string): ServeFrame | null => {
  const parsed = serveFrameSchema.safeParse(parsedJson(raw))
  return parsed.success ? parsed.data : null
}

export const decodeClientFrame = (raw: string): ClientFrame | null => {
  const parsed = clientFrameSchema.safeParse(parsedJson(raw))
  return parsed.success ? parsed.data : null
}
