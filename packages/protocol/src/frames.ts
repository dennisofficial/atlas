import { z } from 'zod'

export enum EDaemonErrorKind {
  BootChanged = 'boot-changed',
  StaleEpoch = 'stale-epoch',
  UnknownKey = 'unknown-key',
  Cancelled = 'cancelled',
  Internal = 'internal',
}

export const callKeySchema = z.string().min(1)
export const bootIdSchema = z.string().min(1)
export const epochSchema = z.number().int().min(0)

export const hostHelloFrameSchema = z.object({
  kind: z.literal('hello'),
  sessionId: z.string().min(1),
  epoch: epochSchema,
  token: z.string().min(1),
})

export const callOpSchema = z.object({
  tool: z.string().min(1),
  input: z.unknown().optional(),
})

export const runFrameSchema = z.object({
  kind: z.literal('run'),
  key: callKeySchema,
  bootId: bootIdSchema,
  op: callOpSchema,
})

export const collectFrameSchema = z.object({
  kind: z.literal('collect'),
  key: callKeySchema,
  afterOffset: z.number().int().min(0).optional(),
})

export const ackFrameSchema = z.object({
  kind: z.literal('ack'),
  key: callKeySchema,
})

export const cancelFrameSchema = z.object({
  kind: z.literal('cancel'),
  key: callKeySchema,
})

export const pingFrameSchema = z.object({ kind: z.literal('ping') })

export const hostFrameSchema = z.discriminatedUnion('kind', [
  hostHelloFrameSchema,
  runFrameSchema,
  collectFrameSchema,
  ackFrameSchema,
  cancelFrameSchema,
  pingFrameSchema,
])

export const outputChunkFrameSchema = z.object({
  kind: z.literal('output'),
  key: callKeySchema,
  offset: z.number().int().min(0),
  bytes: z.string(),
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
})

export const daemonErrorFrameSchema = z.object({
  kind: z.literal('error'),
  key: callKeySchema.optional(),
  errorKind: z.enum(EDaemonErrorKind),
  message: z.string(),
})

export const pongFrameSchema = z.object({ kind: z.literal('pong') })

export const daemonFrameSchema = z.discriminatedUnion('kind', [
  outputChunkFrameSchema,
  resultFrameSchema,
  healthFrameSchema,
  daemonErrorFrameSchema,
  pongFrameSchema,
])

export type HostHelloFrame = z.infer<typeof hostHelloFrameSchema>
export type CallOp = z.infer<typeof callOpSchema>
export type RunFrame = z.infer<typeof runFrameSchema>
export type CollectFrame = z.infer<typeof collectFrameSchema>
export type AckFrame = z.infer<typeof ackFrameSchema>
export type CancelFrame = z.infer<typeof cancelFrameSchema>
export type HostFrame = z.infer<typeof hostFrameSchema>
export type OutputChunkFrame = z.infer<typeof outputChunkFrameSchema>
export type CallResult = z.infer<typeof callResultSchema>
export type ResultFrame = z.infer<typeof resultFrameSchema>
export type HealthFrame = z.infer<typeof healthFrameSchema>
export type DaemonErrorFrame = z.infer<typeof daemonErrorFrameSchema>
export type DaemonFrame = z.infer<typeof daemonFrameSchema>
