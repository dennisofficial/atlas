import { z } from 'zod'

import { ECompactionAnchor, type EventBody } from '../events/body'
import { eventIdSchema, runIdSchema, threadIdSchema } from '../events/ids'
import type { EventId, RunId, ThreadId } from '../events/ids'
import { createEventBodySchema, type EventBodySchemaArgs } from '../events/create-schema'
import type { PluginEventBody } from '../events/plugin-registry'
import { branchesObservedSchema, type BranchesObserved } from './branches'
import { retryScheduledSchema, type RetryScheduled } from './retry-scheduled'
import { sessionStartFailedSchema, type SessionStartFailed } from './start-failure'
import {
  workspacePrepareFailedSchema,
  workspacePreparedSchema,
  workspaceStepSchema,
  type WorkspacePrepared,
  type WorkspacePrepareFailed,
  type WorkspaceStep,
} from './workspace'

export type Hash = string & { readonly __brand: 'Hash' }

export type RecordEnvelope = {
  id: EventId
  seq: number
  threadId: ThreadId
  runId: RunId
  parentRunId?: RunId | undefined
  depth: number
  at: string
  epoch: number
  prevHash: Hash
}

export enum EInputConsumed {
  Message = 'message',
  Stop = 'stop',
  Discarded = 'discarded',
  Command = 'command',
}

export type RecordBody =
  | {
      type: 'history-rewound'
      toSeq: number
      draft?: string | undefined
      inboxId?: number | undefined
    }
  | {
      type: 'history-summarised'
      fromSeq: number
      throughSeq: number
      anchor: ECompactionAnchor
      summary: string
      inboxId?: number | undefined
    }
  | { type: 'input-consumed'; inboxId: number; consumed?: EInputConsumed | undefined }
  | { type: 'input-refused'; inboxId: number; reason: string }
  | { type: 'fact-recorded'; key: string; kind: string; value?: unknown }
  | RetryScheduled
  | BranchesObserved
  | WorkspacePrepared
  | WorkspacePrepareFailed
  | WorkspaceStep
  | SessionStartFailed

export type V2Body =
  | Exclude<EventBody, { type: 'history-compacted' }>
  | RecordBody
  | PluginEventBody

export type StampedV2<TBody> = TBody extends unknown ? TBody & RecordEnvelope : never

export type V2Event = StampedV2<V2Body>

export type V2EventType = V2Event['type']

const HASH_PATTERN = /^[0-9a-f]{64}$/

export const isHash = (value: string): value is Hash => HASH_PATTERN.test(value)

export const hashSchema: z.ZodType<Hash> = z
  .string()
  .refine(isHash, { message: 'expected 64 lowercase hex characters' })
  .transform((value) => value as Hash)

const seqSchema = z.number().int().min(1)

const recordEnvelopeSchema = z.object({
  id: eventIdSchema,
  seq: seqSchema,
  threadId: threadIdSchema,
  runId: runIdSchema,
  parentRunId: runIdSchema.optional(),
  depth: z.number().int().min(0),
  at: z.string().min(1),
  epoch: z.number().int().min(0),
  prevHash: hashSchema,
})

const recordBodySchema: z.ZodType<RecordBody> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('history-rewound'),
    toSeq: z.number().int().min(0),
    draft: z.string().optional(),
    inboxId: z.number().int().min(1).optional(),
  }),
  z.object({
    type: z.literal('history-summarised'),
    fromSeq: seqSchema,
    throughSeq: seqSchema,
    anchor: z.enum(ECompactionAnchor),
    summary: z.string(),
    inboxId: z.number().int().min(1).optional(),
  }),
  z.object({
    type: z.literal('input-consumed'),
    inboxId: z.number().int().min(1),
    consumed: z.enum(EInputConsumed).optional(),
  }),
  z.object({
    type: z.literal('input-refused'),
    inboxId: z.number().int().min(1),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('fact-recorded'),
    key: z.string().min(1),
    kind: z.string().min(1),
    value: z.unknown().optional(),
  }),
  retryScheduledSchema,
  branchesObservedSchema,
  workspacePreparedSchema,
  workspacePrepareFailedSchema,
  workspaceStepSchema,
  sessionStartFailedSchema,
])

const RECORD_TYPE_TABLE = {
  'history-rewound': true,
  'history-summarised': true,
  'input-consumed': true,
  'input-refused': true,
  'fact-recorded': true,
  'retry-scheduled': true,
  'branches-observed': true,
  'workspace-prepared': true,
  'workspace-prepare-failed': true,
  'workspace-step': true,
  'session-start-failed': true,
} satisfies Record<RecordBody['type'], true>

export const RECORD_ONLY_TYPES: ReadonlySet<V2EventType> = new Set<V2EventType>(
  Object.keys(RECORD_TYPE_TABLE) as RecordBody['type'][],
)

const typeOf = (raw: unknown): unknown =>
  typeof raw === 'object' && raw !== null && 'type' in raw ? raw.type : undefined

const bodySchemaFor = (params: {
  raw: unknown
  composedBody: z.ZodType<V2Body>
}): z.ZodType<V2Body> => {
  const type = typeOf(params.raw)
  if (type === 'history-compacted') return z.never()
  if (typeof type === 'string' && Object.hasOwn(RECORD_TYPE_TABLE, type)) return recordBodySchema
  return params.composedBody
}

export const createV2EventSchema = (args: EventBodySchemaArgs = {}): z.ZodType<V2Event> => {
  const composedBody = createEventBodySchema(args) as z.ZodType<V2Body>
  return z.unknown().transform((raw, ctx) => {
    const envelope = recordEnvelopeSchema.safeParse(raw)
    const body = bodySchemaFor({ raw, composedBody }).safeParse(raw)
    for (const result of [envelope, body]) {
      if (result.success) continue
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path })
      }
    }
    if (!envelope.success || !body.success) return z.NEVER
    return { ...body.data, ...envelope.data } as V2Event
  })
}

export const v2EventSchema: z.ZodType<V2Event> = createV2EventSchema({ pluginBodies: [] })
