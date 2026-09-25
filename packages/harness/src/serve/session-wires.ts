import type { Event } from '@dltech/atlas-core'

import type { WireEvent, WireThread, WireTurn } from '../cloud/session-wire'
import { wireDraftOf } from '../cloud/session-wire'
import type { TurnSpend } from '../ledger/turn-ledger.port'
import type { ThreadSummary } from '../store/thread-store'

export function wireEventOf(event: Event): WireEvent {
  const draft = wireDraftOf(event)
  return {
    id: event.id,
    threadId: event.threadId,
    seq: event.seq,
    runId: event.runId,
    ...(event.parentRunId === undefined ? {} : { parentRunId: event.parentRunId }),
    depth: event.depth,
    at: event.at,
    type: draft.type,
    body: draft.body,
    ...(draft.contextSlot === undefined ? {} : { contextSlot: draft.contextSlot }),
    ...(draft.contextKey === undefined ? {} : { contextKey: draft.contextKey }),
    ...(draft.contextDigest === undefined ? {} : { contextDigest: draft.contextDigest }),
  }
}

export function wireThreadOf(thread: ThreadSummary): WireThread {
  return {
    id: thread.id,
    ...(thread.title === undefined ? {} : { title: thread.title }),
    head: thread.head,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    ...(thread.parent === undefined
      ? {}
      : { parent: { threadId: thread.parent.threadId, forkSeq: thread.parent.forkSeq } }),
    ...(thread.forkMode === undefined ? {} : { forkMode: thread.forkMode }),
    ...(thread.agent === undefined
      ? {}
      : { agent: { spawnedBy: thread.agent.spawnedBy, type: thread.agent.type } }),
    workspace: thread.workspace,
    repo: thread.repo,
    ...(thread.model === undefined ? {} : { model: thread.model }),
    ...(thread.worktree === undefined ? {} : { worktree: thread.worktree }),
    ...(thread.pullRequests === undefined ? {} : { pullRequests: [...thread.pullRequests] }),
    ...(thread.executionLocation === undefined
      ? {}
      : { executionLocation: thread.executionLocation }),
  }
}

export function wireTurnOf(spend: TurnSpend): WireTurn {
  return {
    runId: spend.runId,
    threadId: spend.threadId,
    status: spend.status,
    providerId: spend.providerId,
    modelId: spend.modelId,
    steps: spend.steps,
    inputTokens: spend.inputTokens,
    outputTokens: spend.outputTokens,
    cacheReadTokens: spend.cacheReadTokens,
    cacheWriteTokens: spend.cacheWriteTokens,
    startedAt: spend.startedAt,
    endedAt: spend.endedAt,
    durationMs: spend.durationMs,
  }
}
