import { z } from 'zod'

import {
  callIdSchema,
  eventBodySchema,
  rosterWireSchema,
  runIdSchema,
  threadIdSchema,
  type SaidImage,
} from '@dltech/atlas-core'

import { ETurnStatus, type TurnOutcome } from '../loop/turn-outcome'

import { channelSignalSchema } from './signal-wire'

export const CHANNEL_SUBPROTOCOL = 'atlas.v1'

/**
 * Bumped by hand when a frame's shape changes. The TUI and the serve are built at different times
 * from different releases — the TUI from the operator's build, the serve from whatever the API's
 * deploy last downloaded into the sandbox — so each side stamps its own copy onto the hello and
 * the ready, and a mismatch refuses legibly instead of failing on the first changed frame.
 */
export const CHANNEL_PROTOCOL_VERSION = 4

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
  Roster = 'roster',
  Error = 'error',
}

export enum EClientFrame {
  Hello = 'hello',
  Send = 'send',
  Run = 'run',
  Interrupt = 'interrupt',
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
}

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

const seqSchema = z.number().int().nonnegative()

export const turnOutcomeWireSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal(ETurnStatus.Completed), runId: runIdSchema }),
  z.object({
    status: z.literal(ETurnStatus.Paused),
    runId: runIdSchema,
    callId: callIdSchema,
    reason: z.string(),
  }),
  z.object({ status: z.literal(ETurnStatus.Idle), runId: runIdSchema }),
  z.object({
    status: z.literal(ETurnStatus.Interrupted),
    runId: runIdSchema,
    committed: z.boolean(),
  }),
  z.object({ status: z.literal(ETurnStatus.Failed), runId: runIdSchema, message: z.string() }),
])

export type TurnOutcomeWire = z.infer<typeof turnOutcomeWireSchema>

const saidImageWireSchema: z.ZodType<SaidImage> = z.object({
  path: z.string(),
  mediaType: z.string(),
  data: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export const turnOutcomeFromWire = (outcome: TurnOutcomeWire): TurnOutcome => {
  if (outcome.status !== ETurnStatus.Failed) return outcome
  return { ...outcome, cause: undefined }
}

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
  }),
  z.object({ kind: z.literal(EServeFrame.Signal), seq: seqSchema, signal: channelSignalSchema }),
  z.object({
    kind: z.literal(EServeFrame.Reply),
    replyTo: z.string().min(1),
    ok: z.boolean(),
    data: z.unknown(),
  }),
  z.object({ kind: z.literal(EServeFrame.Reload), sinceEventSeq: seqSchema }),
  z.object({ kind: z.literal(EServeFrame.Parked), reason: z.string() }),
  z.object({ kind: z.literal(EServeFrame.TurnEnded), outcome: turnOutcomeWireSchema }),
  z.object({ kind: z.literal(EServeFrame.InterruptAcked), seq: seqSchema }),
  z.object({ kind: z.literal(EServeFrame.Roster), roster: rosterWireSchema }),
  z.object({ kind: z.literal(EServeFrame.Error), message: z.string() }),
])

export type ServeFrame = z.infer<typeof serveFrameSchema>

export const clientFrameSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(EClientFrame.Hello),
    threadId: threadIdSchema,
    channelCursor: seqSchema.nullable(),
    lastEventSeq: seqSchema,
    protocol: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal(EClientFrame.Send),
    text: z.string(),
    images: z.array(saidImageWireSchema).optional(),
    context: z.array(eventBodySchema).optional(),
  }),
  z.object({ kind: z.literal(EClientFrame.Run) }),
  z.object({ kind: z.literal(EClientFrame.Interrupt) }),
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
