import { z } from 'zod'

import { callOpSchema } from './ops'

export enum EDaemonErrorKind {
  BootChanged = 'boot-changed',
  StaleEpoch = 'stale-epoch',
  UnknownKey = 'unknown-key',
  Cancelled = 'cancelled',
  Internal = 'internal',
}

export const callKeySchema = z.string().min(1)
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

export const runReplyFrameSchema = z.object({
  kind: z.literal('run-reply'),
  key: callKeySchema,
  state: z.enum(['running', 'done']),
})

export const callResultSchema = z.object({
  exitCode: z.number().int().nullable(),
  output: z.string().optional(),
  error: z.string().optional(),
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
  memory: z.object({ current: z.number().int().min(0), max: z.number().int().min(0) }).optional(),
})

export const daemonErrorFrameSchema = z.object({
  kind: z.literal('error'),
  key: callKeySchema.optional(),
  errorKind: z.enum(EDaemonErrorKind),
  message: z.string(),
})

export const pongFrameSchema = z.object({ kind: z.literal('pong') })

export const daemonEventFrameSchema = z.object({
  kind: z.literal('event'),
  group: z.string().min(1),
  event: z.string().min(1),
  data: z.unknown().optional(),
})

export const daemonFrameSchema = z.discriminatedUnion('kind', [
  helloReplyFrameSchema,
  outputChunkFrameSchema,
  runReplyFrameSchema,
  resultFrameSchema,
  healthFrameSchema,
  daemonErrorFrameSchema,
  pongFrameSchema,
  daemonEventFrameSchema,
])

export type HostHelloFrame = z.infer<typeof hostHelloFrameSchema>
export type HelloReplyFrame = z.infer<typeof helloReplyFrameSchema>
export type { CallOp } from './ops'
export type RunFrame = z.infer<typeof runFrameSchema>
export type AckFrame = z.infer<typeof ackFrameSchema>
export type CancelFrame = z.infer<typeof cancelFrameSchema>
export type HostFrame = z.infer<typeof hostFrameSchema>
export type OutputChunkFrame = z.infer<typeof outputChunkFrameSchema>
export type RunReplyFrame = z.infer<typeof runReplyFrameSchema>
export type CallResult = z.infer<typeof callResultSchema>
export type ResultFrame = z.infer<typeof resultFrameSchema>
export type HealthFrame = z.infer<typeof healthFrameSchema>
export type DaemonErrorFrame = z.infer<typeof daemonErrorFrameSchema>
export type DaemonEventFrame = z.infer<typeof daemonEventFrameSchema>
export type DaemonFrame = z.infer<typeof daemonFrameSchema>
