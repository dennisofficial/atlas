import { z } from 'zod'

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
export const CHANNEL_PROTOCOL_VERSION = 14

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
  /**
   * The operator terminal's whole user settings document, sent on attach and again on each
   * local change, so a cloud session resolves the same settings as the terminal that owns it.
   * The serve applies the document wholesale and never sends settings back; a serve built
   * before this frame version-refuses the socket at hello.
   */
  Settings = 'settings',
  Request = 'request',
  Pong = 'pong',
}

export enum EClientRequest {
  CompletePaths = 'complete-paths',
  BrowseDirectory = 'browse-directory',
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
  /**
   * Takes the newest unreserved operator message back out of the sandbox's pending queue and
   * returns it for the composer, so the take-back is confirmed by the queue's owner. A serve built
   * before this op refuses the request, and the client falls back to its local in-memory queue.
   */
  TakeBackPending = 'take-back-pending',
  /**
   * The descend's workspace transfer: the sandbox captures its effective project directory (all
   * Git worktrees, staged and ignored files included) into a dedicated export directory and
   * answers the archive's path plus its manifest. The bytes never ride the socket.
   */
  PrepareWorkspaceArchive = 'prepare-workspace-archive',
  /**
   * The relift's workspace generation: restores the archive the client uploaded to the drive's
   * bootstrap directory, once per archive digest, so an already-healthy serve takes the new
   * generation without a restart. Refused while a turn is running.
   */
  ApplyWorkspaceArchive = 'apply-workspace-archive',
  /**
   * The lift's commit point on the destination: until it arrives, a freshly bootstrapped workspace
   * generation stays dormant (no child adoption, no sends or runs), so a lift that fails and
   * resumes its source never leaves two writers. Idempotent once activated.
   */
  ActivateSession = 'activate-session',
  /**
   * Operator steering of the sandbox's own agents: a message for a sub-agent or teammate, queued
   * while it steps and restarting it once it has settled, exactly as the local registry's say does.
   * A serve built before these ops version-refuses the socket at hello.
   */
  SayToAgent = 'say-to-agent',
  /** Restart a resumable sub-agent or teammate with no message attached. Same gating as say-to-agent. */
  ResumeAgent = 'resume-agent',
  /** Stop a sub-agent or teammate; the sandbox records the kill as the operator's. Same gating as say-to-agent. */
  StopAgent = 'stop-agent',
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

/** The client assigns each send a correlation id so a re-driven frame is recognized, not re-committed. */
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
