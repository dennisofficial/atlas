import { z } from 'zod'

import {
  EStreamSubscribeKind,
  EStreamSurface,
  STREAM_PROTOCOL_MIN_VERSION,
} from './stream-constants'

const subscribeSessionSchema = z
  .strictObject({
    type: z.literal('subscribe'),
    id: z.string().min(1),
    kind: z.literal(EStreamSubscribeKind.Session),
    sessionId: z.string().min(1),
    afterSeq: z.number().int().min(0).optional(),
    afterHash: z.string().min(1).optional(),
  })
  .refine((m) => m.afterHash === undefined || m.afterSeq !== undefined, {
    message: 'afterHash requires afterSeq',
    path: ['afterHash'],
  })

const subscribeSessionsSchema = z.strictObject({
  type: z.literal('subscribe'),
  id: z.string().min(1),
  kind: z.literal(EStreamSubscribeKind.Sessions),
  projectId: z.string().min(1).optional(),
})

export const streamSubscribeSchema = z.discriminatedUnion('kind', [
  subscribeSessionSchema,
  subscribeSessionsSchema,
])

export const streamClientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('hello'),
    v: z.number().int().min(STREAM_PROTOCOL_MIN_VERSION),
    token: z.string().min(1),
    surface: z.enum(EStreamSurface).optional(),
  }),
  streamSubscribeSchema,
  z.strictObject({ type: z.literal('unsubscribe'), id: z.string().min(1) }),
  z.strictObject({ type: z.literal('resnap'), id: z.string().min(1) }),
  z.strictObject({ type: z.literal('ping') }),
])

export type StreamClientMessage = z.infer<typeof streamClientMessageSchema>
