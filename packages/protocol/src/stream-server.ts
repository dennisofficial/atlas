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

export const streamSessionRowSchema = sessionSummarySchema

const viewFrameShape = { type: z.literal('view'), id: idSchema, at: z.number().int().min(0) }

export const streamViewMessageSchema = z.discriminatedUnion('name', [
  z.strictObject({
    ...viewFrameShape,
    name: z.literal('status'),
    value: sessionStatusOutputSchema,
  }),
  z.strictObject({
    ...viewFrameShape,
    name: z.literal('session'),
    value: sessionViewOutputSchema,
  }),
])

export const streamServerMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('ready'),
    v: z.number().int().min(STREAM_PROTOCOL_MIN_VERSION),
    connectionId: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal('events'),
    id: idSchema,
    events: z.array(sessionEventsOutputSchema.shape.events.element),
    head: z.strictObject({ seq: z.number().int().min(0), hash: z.string().min(1) }),
    live: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('reset'),
    id: idSchema,
    reason: z.enum(EStreamResetReason),
    tailFrom: z.number().int().min(0),
  }),
  streamViewMessageSchema,
  z.strictObject({
    type: z.literal('overlay'),
    id: idSchema,
    key: streamStepKeySchema,
    afterSeq: z.number().int().min(0),
    blocks: z.array(
      z.strictObject({
        block: z.string().min(1),
        kind: z.enum(EStreamBlockKind),
        text: z.string(),
      }),
    ),
  }),
  z.strictObject({
    type: z.literal('delta'),
    id: idSchema,
    key: streamStepKeySchema,
    block: z.string().min(1),
    kind: z.enum(EStreamBlockKind),
    from: z.number().int().min(0),
    text: z.string(),
  }),
  z.strictObject({
    type: z.literal('overlay-clear'),
    id: idSchema,
    reason: z.enum(EStreamClearReason),
  }),
  z.strictObject({ type: z.literal('frame'), id: idSchema, frame: liveFrameSchema }),
  z.strictObject({
    type: z.literal('snapshot'),
    id: idSchema,
    rows: z.array(streamSessionRowSchema),
  }),
  z.strictObject({ type: z.literal('upsert'), id: idSchema, row: streamSessionRowSchema }),
  z.strictObject({ type: z.literal('remove'), id: idSchema, sessionId: z.string().min(1) }),
  z.strictObject({
    type: z.literal('error'),
    id: idSchema.optional(),
    code: z.enum(EStreamErrorCode),
  }),
  z.strictObject({ type: z.literal('closing'), code: z.number().int().min(1000).max(4999) }),
  z.strictObject({
    type: z.literal('going-away'),
    reconnectAfterMs: z.number().int().min(0),
  }),
  z.strictObject({ type: z.literal('pong') }),
])

export type StreamStepKey = z.infer<typeof streamStepKeySchema>
export type StreamSessionRow = z.infer<typeof streamSessionRowSchema>
export type StreamServerMessage = z.infer<typeof streamServerMessageSchema>
