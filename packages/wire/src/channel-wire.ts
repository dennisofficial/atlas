import { z } from 'zod'

import { prStatesWireSchema } from './pr-state-wire.js'
import { rosterWireSchema } from './roster-wire.js'
import { seqSchema, threadIdWireSchema, threadModelWireSchema } from './request-wire.js'
import { runtimeCheckpointSchema } from './runtime-checkpoint.js'
import { channelSignalSchema } from './signal-wire.js'

export const CHANNEL_SUBPROTOCOL = 'atlas.v1'

/**
 * Bumped by hand when a frame's shape changes. The TUI and the serve are built at different times
 * from different releases — the TUI from the operator's build, the serve from whatever the API's
 * deploy last downloaded into the sandbox — so each side stamps its own copy onto the hello and
 * the ready, and a mismatch refuses legibly instead of failing on the first changed frame.
 */
export const CHANNEL_PROTOCOL_VERSION = 22

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
  PrStates = 'pr-states',
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
  Settings = 'settings',
  Request = 'request',
  Pong = 'pong',
}

export enum EClientRequest {
  CompletePaths = 'complete-paths',
  BrowseDirectory = 'browse-directory',
  ListRoster = 'list-roster',
  ListPrStates = 'list-pr-states',
  Rewind = 'rewind',
  ReadEvents = 'read-events',
  ReadThread = 'read-thread',
  ReadThreads = 'read-threads',
  ReadTurns = 'read-turns',
  ReadSessionArchive = 'read-session-archive',
  ReadTranscriptIdentity = 'read-transcript-identity',
  ReadMemoryArchive = 'read-memory-archive',
  RenameThread = 'rename-thread',
  SetThreadModel = 'set-thread-model',
  RestoreTranscript = 'restore-transcript',
  ReadRuntimeCheckpoint = 'read-runtime-checkpoint',
  ListContextFiles = 'list-context-files',
  ReadContextFile = 'read-context-file',
  ListMentionFiles = 'list-mention-files',
  MentionFileExists = 'mention-file-exists',
  ReadMentionFile = 'read-mention-file',
  TakeBackPending = 'take-back-pending',
  PrepareWorkspaceArchive = 'prepare-workspace-archive',
  ConfirmWorkspaceCleanup = 'confirm-workspace-cleanup',
  ApplyWorkspaceArchive = 'apply-workspace-archive',
  ActivateSession = 'activate-session',
  SayToAgent = 'say-to-agent',
  ResumeAgent = 'resume-agent',
  StopAgent = 'stop-agent',
  ProvideOperatorInput = 'provide-operator-input',
  CompactHistory = 'compact-history',
  SummariseHistory = 'summarise-history',
  CancelCompaction = 'cancel-compaction',
  Rotate = 'rotate',
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
const sendIdWireSchema = z.string().min(1).brand<'SendId'>()

export type SendId = z.infer<typeof sendIdWireSchema>

export const toSendId = (value: string): SendId => sendIdWireSchema.parse(value)

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

export const takeBackPendingReplySchema = z.object({
  taken: z
    .object({
      text: z.string(),
      images: z.array(saidImageWireSchema).readonly(),
      files: z.array(saidFileWireSchema).readonly(),
      context: z.array(z.unknown()).readonly().optional(),
    })
    .nullable(),
})
export type TakeBackPendingReply = z.infer<typeof takeBackPendingReplySchema>

export const sayToAgentParamsSchema = z.object({
  threadId: threadIdWireSchema,
  agentId: threadIdWireSchema,
  text: z.string(),
  images: z.array(saidImageWireSchema).readonly().optional(),
  files: z.array(saidFileWireSchema).readonly().optional(),
})
export type SayToAgentParams = z.infer<typeof sayToAgentParamsSchema>

export const serveFrameSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(EServeFrame.Ready),
    seq: seqSchema,
    protocol: z.number().int().nonnegative().optional(),
    turnInFlight: z.boolean().optional(),
    transcriptCurrent: z.boolean().optional(),
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
  z.object({ kind: z.literal(EServeFrame.PrStates), states: prStatesWireSchema.shape.states }),
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
  z.object({ kind: z.literal(EClientFrame.Run), resume: z.boolean().optional() }),
  z.object({ kind: z.literal(EClientFrame.Interrupt) }),
  z.object({ kind: z.literal(EClientFrame.Pause) }),
  z.object({ kind: z.literal(EClientFrame.Resume) }),
  z.object({ kind: z.literal(EClientFrame.Settings), content: z.string() }),
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
