import { z } from 'zod'

import { ECompactionAnchor, type EventBody } from '../events/body'
import { eventIdSchema, runIdSchema, threadIdSchema } from '../events/ids'
import type { EventId, RunId, ThreadId } from '../events/ids'
import { createEventBodySchema, type EventBodySchemaArgs } from '../events/create-schema'
import type { PluginEventBody } from '../events/plugin-registry'
import { branchesObservedSchema, type BranchesObserved } from './branches'
import { contextChangedSchema, type ContextChanged } from './context-changed'
import {
  inputPostedSchema,
  inputRefusedSchema,
  inputWithdrawnSchema,
  type InputPosted,
  type InputRefused,
  type InputWithdrawn,
} from './input-events'
import { resourceLoadedSchema, type ResourceLoaded } from './resource-loaded'
import { retryScheduledSchema, type RetryScheduled } from './retry-scheduled'
import { sessionStartFailedSchema, type SessionStartFailed } from './start-failure'
import { turnEndedSchema, turnStartedSchema, type TurnEnded, type TurnStarted } from './turns'
import {
  workspaceAttemptStartedSchema,
  workspacePrepareFailedSchema,
  workspacePreparedSchema,
  workspaceStepSchema,
  type WorkspaceAttemptStarted,
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

export enum ERewindCause {
  Operator = 'operator',
  QuickStop = 'quick-stop',
}

export enum EInputConsumed {
  Message = 'message',
  Stop = 'stop',
  Discarded = 'discarded',
  Command = 'command',
}

export type ConsumedCommand = { name: string; argumentText: string; text: string }

export const consumedCommandSchema: z.ZodType<ConsumedCommand> = z.strictObject({
  name: z.string().min(1),
  argumentText: z.string(),
  text: z.string(),
})

export type RecordBody =
  | {
      type: 'history-rewound'
      toSeq: number
      draft?: string | undefined
      inboxId?: number | undefined
      cause?: ERewindCause | undefined
    }
  | {
      type: 'history-summarised'
      fromSeq: number
      throughSeq: number
      anchor: ECompactionAnchor
      summary: string
      inboxId?: number | undefined
    }
  | {
      type: 'input-consumed'
      inboxId: number
      consumed?: EInputConsumed | undefined
      command?: ConsumedCommand | undefined
    }
  | InputPosted
  | InputWithdrawn
  | InputRefused
  | { type: 'idle-released'; inboxHead: number }
  | { type: 'fact-recorded'; key: string; kind: string; value?: unknown }
  | RetryScheduled
  | ResourceLoaded
  | ContextChanged
  | BranchesObserved
  | WorkspacePrepared
  | WorkspacePrepareFailed
  | WorkspaceStep
  | WorkspaceAttemptStarted
  | SessionStartFailed
  | TurnStarted
  | TurnEnded

export type RecordEventBody =
  | Exclude<EventBody, { type: 'history-compacted' }>
  | RecordBody
  | PluginEventBody

export type StampedRecord<TBody> = TBody extends unknown ? TBody & RecordEnvelope : never

export type RecordEvent = StampedRecord<RecordEventBody>

export type RecordEventType = RecordEvent['type']

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
    cause: z.enum(ERewindCause).optional(),
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
    command: consumedCommandSchema.optional(),
  }),
  inputPostedSchema,
  inputWithdrawnSchema,
  inputRefusedSchema,
  z.object({
    type: z.literal('idle-released'),
    inboxHead: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('fact-recorded'),
    key: z.string().min(1),
    kind: z.string().min(1),
    value: z.unknown().optional(),
  }),
  retryScheduledSchema,
  resourceLoadedSchema,
  contextChangedSchema,
  branchesObservedSchema,
  workspacePreparedSchema,
  workspacePrepareFailedSchema,
  workspaceStepSchema,
  workspaceAttemptStartedSchema,
  sessionStartFailedSchema,
  turnStartedSchema,
  turnEndedSchema,
])

const RECORD_TYPE_TABLE = {
  'history-rewound': true,
  'history-summarised': true,
  'input-consumed': true,
  'input-posted': true,
  'input-withdrawn': true,
  'input-refused': true,
  'idle-released': true,
  'fact-recorded': true,
  'retry-scheduled': true,
  'resource-loaded': true,
  'context-changed': true,
  'branches-observed': true,
  'workspace-prepared': true,
  'workspace-prepare-failed': true,
  'workspace-step': true,
  'workspace-attempt-started': true,
  'session-start-failed': true,
  'turn-started': true,
  'turn-ended': true,
} satisfies Record<RecordBody['type'], true>

export const RECORD_ONLY_TYPES: ReadonlySet<RecordEventType> = new Set<RecordEventType>(
  Object.keys(RECORD_TYPE_TABLE) as RecordBody['type'][],
)

const typeOf = (raw: unknown): unknown =>
  typeof raw === 'object' && raw !== null && 'type' in raw ? raw.type : undefined

const bodySchemaFor = (params: {
  raw: unknown
  composedBody: z.ZodType<RecordEventBody>
}): z.ZodType<RecordEventBody> => {
  const type = typeOf(params.raw)
  if (type === 'history-compacted') return z.never()
  if (typeof type === 'string' && Object.hasOwn(RECORD_TYPE_TABLE, type)) return recordBodySchema
  return params.composedBody
}

export const createRecordEventSchema = (args: EventBodySchemaArgs = {}): z.ZodType<RecordEvent> => {
  const composedBody = createEventBodySchema(args) as z.ZodType<RecordEventBody>
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
    return { ...body.data, ...envelope.data } as RecordEvent
  })
}

export const recordEventSchema: z.ZodType<RecordEvent> = createRecordEventSchema({
  pluginBodies: [],
})
