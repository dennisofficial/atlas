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
import type { WireDraft, WireEvent, WireThread } from '@dltech/atlas-wire'

export { wireEventSchema, wireThreadSchema, wireTurnSchema } from '@dltech/atlas-wire'
export type { WireDraft, WireEvent, WireThread, WireTurn } from '@dltech/atlas-wire'

import type { ThreadSummary } from '../store/thread-store'
import { contextDigestOf } from '../store/context-digest'
import { UnreadableWrite } from '../store/sessions/lines'

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
