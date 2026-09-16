import {
  EForkMode,
  eventBodySchema,
  executionLocationOf,
  stampEvent,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
  type EventEnvelope,
} from '@dltech/atlas-core'
import { z } from 'zod'

import type { ThreadSummary } from '../store/thread-store'
import { contextDigestOf } from '../store/context-digest'
import { UnreadableWrite } from '../store/event-row'

export const wireThreadSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  head: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  parent: z.object({ threadId: z.string(), forkSeq: z.number().int() }).optional(),
  forkMode: z.enum(['reference', 'copy']).optional(),
  agent: z.object({ spawnedBy: z.string(), type: z.string() }).optional(),
  workspace: z.string().nullable(),
  repo: z.string().nullable(),
  model: z.object({ ref: z.string(), effort: z.string() }).optional(),
  worktree: z.object({ path: z.string(), branch: z.string() }).optional(),
  pullRequests: z
    .array(z.object({ number: z.number(), url: z.string(), repo: z.string(), branch: z.string() }))
    .optional(),
  executionLocation: z.string().optional(),
})

export type WireThread = z.infer<typeof wireThreadSchema>

export const wireEventSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  seq: z.number().int(),
  runId: z.string(),
  parentRunId: z.string().optional(),
  depth: z.number().int(),
  at: z.string(),
  type: z.string(),
  body: z.string(),
  contextSlot: z.string().optional(),
  contextKey: z.string().optional(),
  contextDigest: z.string().optional(),
})

export type WireEvent = z.infer<typeof wireEventSchema>

export const wireTurnSchema = z.object({
  runId: z.string(),
  threadId: z.string(),
  status: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  steps: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number().int(),
})

export type WireTurn = z.infer<typeof wireTurnSchema>

export type WireDraft = {
  type: string
  body: string
  contextSlot?: string | undefined
  contextKey?: string | undefined
  contextDigest?: string | undefined
}

export function wireDraftOf(draft: EventDraft): WireDraft {
  const body = JSON.stringify(draft)
  const readable = eventBodySchema.safeParse(JSON.parse(body))
  if (!readable.success) {
    throw new UnreadableWrite({ type: draft.type, detail: readable.error.message })
  }

  return {
    type: draft.type,
    body,
    ...(draft.type === 'context-loaded'
      ? {
          contextSlot: draft.slot,
          contextKey: draft.key,
          contextDigest: contextDigestOf(draft.content),
        }
      : {}),
  }
}

export function eventFromWire(wire: WireEvent): Event {
  const envelope: EventEnvelope = {
    id: toEventId(wire.id),
    seq: wire.seq,
    threadId: toThreadId(wire.threadId),
    runId: toRunId(wire.runId),
    depth: wire.depth,
    at: wire.at,
    ...(wire.parentRunId === undefined ? {} : { parentRunId: toRunId(wire.parentRunId) }),
  }
  const draft = eventBodySchema.parse(JSON.parse(wire.body))
  return stampEvent({ draft, envelope })
}

export function threadFromWire(wire: WireThread): ThreadSummary {
  const location = executionLocationOf(wire.executionLocation)
  return {
    id: toThreadId(wire.id),
    head: wire.head,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
    workspace: wire.workspace,
    repo: wire.repo,
    ...(wire.title === undefined ? {} : { title: wire.title }),
    ...(wire.parent === undefined
      ? {}
      : { parent: { threadId: toThreadId(wire.parent.threadId), forkSeq: wire.parent.forkSeq } }),
    ...(wire.forkMode === 'reference'
      ? { forkMode: EForkMode.Reference }
      : wire.forkMode === 'copy'
        ? { forkMode: EForkMode.Copy }
        : {}),
    ...(wire.agent === undefined
      ? {}
      : { agent: { spawnedBy: toThreadId(wire.agent.spawnedBy), type: wire.agent.type } }),
    ...(wire.model === undefined ? {} : { model: wire.model }),
    ...(wire.worktree === undefined ? {} : { worktree: wire.worktree }),
    ...(wire.pullRequests === undefined ? {} : { pullRequests: [...wire.pullRequests] }),
    ...(location === undefined ? {} : { executionLocation: location }),
  }
}
