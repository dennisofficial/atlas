import {
  canonicalEvent,
  canonicalJson,
  EMPTY_VISIBILITY,
  recordEventSchema,
  type Hash,
  type RecordEvent,
  type VisibilityState,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { RecordCorruptError } from './refusal'
import type { StoredEvent } from './port'

const visibilitySchema: z.ZodType<VisibilityState> = z.object({
  spans: z.array(
    z.object({
      createdAt: z.number().int(),
      fromSeq: z.number().int(),
      throughSeq: z.number().int(),
      keepSurvivors: z.boolean(),
      keepTurns: z.boolean().default(false),
    }),
  ),
})

export const EMPTY_VISIBILITY_TEXT = canonicalJson(EMPTY_VISIBILITY)

export function decodeVisibility(text: string): VisibilityState {
  const parsed = visibilitySchema.safeParse(JSON.parse(text))
  if (!parsed.success) throw new RecordCorruptError('stored visibility state is invalid')
  return parsed.data
}

export const toStoredEvent = (params: { event: RecordEvent; hash: Hash }): StoredEvent => ({
  threadId: params.event.threadId,
  seq: params.event.seq,
  id: params.event.id,
  epoch: params.event.epoch,
  type: params.event.type,
  runId: params.event.runId,
  at: params.event.at,
  prevHash: params.event.prevHash,
  hash: params.hash,
  canonical: canonicalJson(params.event),
})

const ISSUE_MESSAGE_LIMIT = 160

const firstIssueOf = (error: z.ZodError): string => {
  const issue = error.issues[0]
  if (issue === undefined) return 'no issue reported'
  const path = issue.path.length === 0 ? '(root)' : issue.path.join('.')
  return `${path}: ${issue.message.slice(0, ISSUE_MESSAGE_LIMIT)}`
}

export function decodeStoredEvent(
  row: StoredEvent,
  eventSchema: z.ZodType<RecordEvent> = recordEventSchema,
): RecordEvent {
  const parsed = eventSchema.safeParse(JSON.parse(row.canonical))
  if (!parsed.success) {
    throw new RecordCorruptError(
      `stored event ${row.threadId}:${row.seq} is invalid (type ${row.type}; ${firstIssueOf(parsed.error)})`,
    )
  }
  if (parsed.data.seq !== row.seq || parsed.data.threadId !== row.threadId) {
    throw new RecordCorruptError(`stored event ${row.threadId}:${row.seq} disagrees with its row`)
  }
  return canonicalEvent(parsed.data)
}
