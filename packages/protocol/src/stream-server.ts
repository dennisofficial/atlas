import { z } from 'zod'

import {
  sessionEventsOutputSchema,
  sessionStatusOutputSchema,
  sessionSummarySchema,
  sessionViewOutputSchema,
} from './api'
import { liveFrameSchema } from './bus'
import {
  EStreamBlockKind,
  EStreamClearReason,
  EStreamErrorCode,
  EStreamResetReason,
  STREAM_PROTOCOL_MIN_VERSION,
} from './stream-constants'
import { streamStepKeySchema } from './stream-step-key'

const idSchema = z.string().min(1)

export { streamStepKeySchema }

// Server frames and rows strip unknown keys so a client behind the API keeps reading once the
// server adds a field: the API deploys on every merge while the app ships by OTA and the TUI by
// release.
export const streamSessionRowSchema = z.object(sessionSummarySchema.shape)

const viewFrameShape = { type: z.literal('view'), id: idSchema, at: z.number().int().min(0) }

export const streamViewMessageSchema = z.discriminatedUnion('name', [
  z.object({
    ...viewFrameShape,
    name: z.literal('status'),
    value: sessionStatusOutputSchema,
  }),
  z.object({
    ...viewFrameShape,
    name: z.literal('session'),
    value: sessionViewOutputSchema,
  }),
])

export const streamServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    v: z.number().int().min(STREAM_PROTOCOL_MIN_VERSION),
    connectionId: z.string().min(1),
    eventTypes: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    type: z.literal('events'),
    id: idSchema,
    events: z.array(sessionEventsOutputSchema.shape.events.element),
    head: z.object({ seq: z.number().int().min(0), hash: z.string().min(1) }),
    cursor: z.object({ seq: z.number().int().min(0), hash: z.string().min(1) }).optional(),
    live: z.boolean(),
  }),
  z.object({
    type: z.literal('reset'),
    id: idSchema,
    reason: z.enum(EStreamResetReason),
    tailFrom: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('base'),
    id: idSchema,
    cursor: z.object({ seq: z.number().int().min(1), hash: z.string().min(1) }),
    visibility: z.record(z.string(), z.unknown()),
    view: z.record(z.string(), z.unknown()),
    durable: z.array(sessionEventsOutputSchema.shape.events.element),
    commandLog: z.array(sessionEventsOutputSchema.shape.events.element),
  }),
  streamViewMessageSchema,
  z.object({
    type: z.literal('overlay'),
    id: idSchema,
    key: streamStepKeySchema,
    afterSeq: z.number().int().min(0),
    blocks: z.array(
      z.object({
        block: z.string().min(1),
        kind: z.enum(EStreamBlockKind),
        text: z.string(),
      }),
    ),
  }),
  z.object({
    type: z.literal('delta'),
    id: idSchema,
    key: streamStepKeySchema,
    block: z.string().min(1),
    kind: z.enum(EStreamBlockKind),
    from: z.number().int().min(0),
    text: z.string(),
  }),
  z.object({
    type: z.literal('overlay-clear'),
    id: idSchema,
    reason: z.enum(EStreamClearReason),
  }),
  z.object({ type: z.literal('frame'), id: idSchema, frame: liveFrameSchema }),
  z.object({
    type: z.literal('snapshot'),
    id: idSchema,
    rows: z.array(streamSessionRowSchema),
  }),
  z.object({ type: z.literal('upsert'), id: idSchema, row: streamSessionRowSchema }),
  z.object({ type: z.literal('remove'), id: idSchema, sessionId: z.string().min(1) }),
  z.object({
    type: z.literal('error'),
    id: idSchema.optional(),
    code: z.enum(EStreamErrorCode),
  }),
  z.object({ type: z.literal('closing'), code: z.number().int().min(1000).max(4999) }),
  z.object({
    type: z.literal('going-away'),
    reconnectAfterMs: z.number().int().min(0),
  }),
  z.object({ type: z.literal('pong') }),
])

export type StreamStepKey = z.infer<typeof streamStepKeySchema>
export type StreamSessionRow = z.infer<typeof streamSessionRowSchema>
export type StreamServerMessage = z.infer<typeof streamServerMessageSchema>

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'

export const sessionStreamOutputSchema =
  z.custom<AsyncIterable<StreamServerMessage>>(isAsyncIterable)
