import { z } from 'zod'

import { callIdSchema, runIdSchema, threadIdSchema } from '@dltech/atlas-core'

import { ETurnStatus, type TurnOutcome } from '../loop/turn-outcome'

import { channelSignalSchema } from './signal-wire'

export const CHANNEL_SUBPROTOCOL = 'atlas.v1'

/**
 * Bumped by hand when a frame's shape changes. The TUI and the serve are built at different times
 * from different releases — the TUI from the operator's build, the serve from whatever the API's
 * deploy last downloaded into the sandbox — so each side stamps its own copy onto the hello and
 * the ready, and a mismatch refuses legibly instead of failing on the first changed frame.
 */
export const CHANNEL_PROTOCOL_VERSION = 1

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
}

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

export const turnOutcomeFromWire = (outcome: TurnOutcomeWire): TurnOutcome => {
  if (outcome.status !== ETurnStatus.Failed) return outcome
  return { ...outcome, cause: undefined }
}

export const serveFrameSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(EServeFrame.Ready),
    seq: seqSchema,
    protocol: z.number().int().nonnegative().optional(),
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
  z.object({ kind: z.literal(EClientFrame.Send), text: z.string() }),
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
