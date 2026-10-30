import type { WireThread, WireTurn } from '@dltech/atlas-harness'
export { wireEventOf } from '@dltech/atlas-harness'
import type { TurnSpend } from '@dltech/atlas-harness'
import type { ThreadSummary } from '@dltech/atlas-harness'

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
    ...(thread.runner === undefined ? {} : { runner: thread.runner }),
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
