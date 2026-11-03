import { z } from 'zod'

import { callOpSchema, callResultSchema, daemonEventSchema } from './ops'
import { daemonMemorySchema, protectionReportSchema } from './health'

export enum EDaemonErrorKind {
  BootChanged = 'boot-changed',
  StaleEpoch = 'stale-epoch',
  UnknownKey = 'unknown-key',
  NotDone = 'not-done',
  Unauthenticated = 'unauthenticated',
  InvalidFrame = 'invalid-frame',
  Internal = 'internal',
}

export const callKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]+$/)
  .refine((key) => key.replace(/\./g, '') !== '', 'a key cannot be only dots')
export const epochSchema = z.number().int().min(0)
export const bootIdSchema = z.string().min(1)

export const hostHelloFrameSchema = z.object({
  kind: z.literal('hello'),
  sessionId: z.string().min(1),
  epoch: epochSchema,
  token: z.string().min(1),
})

export const helloReplyFrameSchema = z.object({
  kind: z.literal('hello-reply'),
  bootId: bootIdSchema,
  version: z.string().min(1),
})

export const runFrameSchema = z
  .object({
    kind: z.literal('run'),
    key: callKeySchema,
    epoch: epochSchema,
    op: callOpSchema,
    fromOffset: z.number().int().min(0).optional(),
  })
  .strict()

export const ackFrameSchema = z.object({
  kind: z.literal('ack'),
  key: callKeySchema,
  epoch: epochSchema,
})

export const cancelFrameSchema = z.object({
  kind: z.literal('cancel'),
  key: callKeySchema,
  epoch: epochSchema,
})

export const pingFrameSchema = z.object({ kind: z.literal('ping') })

export const hostFrameSchema = z.discriminatedUnion('kind', [
  hostHelloFrameSchema,
  runFrameSchema,
  ackFrameSchema,
  cancelFrameSchema,
  pingFrameSchema,
])

export const outputChunkFrameSchema = z.object({
  kind: z.literal('output'),
  key: callKeySchema,
  offset: z.number().int().min(0),
  bytes: z.base64(),
})

export enum ERunState {
  Running = 'running',
  Done = 'done',
}

export const runReplyFrameSchema = z.object({
  kind: z.literal('run-reply'),
  key: callKeySchema,
  state: z.enum(ERunState),
})

export const resultFrameSchema = z.object({
  kind: z.literal('result'),
  key: callKeySchema,
  result: callResultSchema,
})

export const healthFrameSchema = z.object({
  kind: z.literal('health'),
  bootId: bootIdSchema,
  version: z.string().min(1),
  protection: protectionReportSchema,
  memory: daemonMemorySchema.optional(),
})

export const daemonErrorFrameSchema = z.object({
  kind: z.literal('error'),
  key: callKeySchema.optional(),
  errorKind: z.enum(EDaemonErrorKind),
  message: z.string(),
})

export const ackedFrameSchema = z.object({ kind: z.literal('acked'), key: callKeySchema })

export const pongFrameSchema = z.object({ kind: z.literal('pong'), runs: z.number().int().min(0) })

export const daemonEventFrameSchema = z.object({
  kind: z.literal('event'),
  event: daemonEventSchema,
})

export const daemonFrameSchema = z.discriminatedUnion('kind', [
  helloReplyFrameSchema,
  outputChunkFrameSchema,
  runReplyFrameSchema,
  resultFrameSchema,
  healthFrameSchema,
  daemonErrorFrameSchema,
  pongFrameSchema,
  ackedFrameSchema,
  daemonEventFrameSchema,
])

export type HostHelloFrame = z.infer<typeof hostHelloFrameSchema>
export type HelloReplyFrame = z.infer<typeof helloReplyFrameSchema>
export type RunFrame = z.infer<typeof runFrameSchema>
export type AckFrame = z.infer<typeof ackFrameSchema>
export type CancelFrame = z.infer<typeof cancelFrameSchema>
export type HostFrame = z.infer<typeof hostFrameSchema>
export type OutputChunkFrame = z.infer<typeof outputChunkFrameSchema>
export type RunReplyFrame = z.infer<typeof runReplyFrameSchema>
export type ResultFrame = z.infer<typeof resultFrameSchema>
export type HealthFrame = z.infer<typeof healthFrameSchema>
export type DaemonErrorFrame = z.infer<typeof daemonErrorFrameSchema>
export type AckedFrame = z.infer<typeof ackedFrameSchema>
export type PongFrame = z.infer<typeof pongFrameSchema>
export type DaemonEventFrame = z.infer<typeof daemonEventFrameSchema>
export type DaemonFrame = z.infer<typeof daemonFrameSchema>
