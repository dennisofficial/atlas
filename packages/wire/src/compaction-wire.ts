import { z } from 'zod'

import { seqSchema, threadIdWireSchema } from './request-wire.js'

export enum EWireCompactScope {
  Recent = 'recent',
  Everything = 'everything',
}

export enum EWireCompactionAnchor {
  Prefix = 'prefix',
  Suffix = 'suffix',
}

const operationIdSchema = z.string().min(1)

export const compactHistoryParamsSchema = z.object({
  threadId: threadIdWireSchema,
  operationId: operationIdSchema,
  scope: z.nativeEnum(EWireCompactScope).default(EWireCompactScope.Recent),
})
export type CompactHistoryParams = z.infer<typeof compactHistoryParamsSchema>

export const summariseHistoryParamsSchema = z.object({
  threadId: threadIdWireSchema,
  operationId: operationIdSchema,
  anchor: z.nativeEnum(EWireCompactionAnchor),
  seq: seqSchema,
})
export type SummariseHistoryParams = z.infer<typeof summariseHistoryParamsSchema>

export const cancelCompactionParamsSchema = z.object({
  threadId: threadIdWireSchema,
  operationId: operationIdSchema,
})
export type CancelCompactionParams = z.infer<typeof cancelCompactionParamsSchema>

export const compactionReplySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('compacted'),
    replaced: seqSchema,
    fromSeq: seqSchema,
    throughSeq: seqSchema,
  }),
  z.object({ type: z.literal('refused'), reason: z.string() }),
  z.object({ type: z.literal('nothing') }),
])
export type CompactionReply = z.infer<typeof compactionReplySchema>
