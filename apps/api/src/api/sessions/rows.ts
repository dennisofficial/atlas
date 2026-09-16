import type { EventModel, ThreadModel, TurnModel } from '../../db'
import type { EventDto, ThreadDto, TurnDto } from './sessions.types'

export function toThreadDto(row: ThreadModel): ThreadDto {
  return {
    id: row.id,
    head: row.head,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    workspace: row.workspace,
    repo: row.repo,
    ...(row.title === null ? {} : { title: row.title }),
    ...(row.parentThreadId === null || row.forkSeq === null
      ? {}
      : { parent: { threadId: row.parentThreadId, forkSeq: row.forkSeq } }),
    ...(row.forkMode === null ? {} : { forkMode: row.forkMode }),
    ...(row.spawnerThreadId === null || row.agentType === null
      ? {}
      : { agent: { spawnedBy: row.spawnerThreadId, type: row.agentType } }),
    ...(row.modelRef === null || row.modelEffort === null
      ? {}
      : { model: { ref: row.modelRef, effort: row.modelEffort } }),
    ...(row.executionLocation === null ? {} : { executionLocation: row.executionLocation }),
  }
}

export function toEventDto(row: EventModel): EventDto {
  return {
    id: row.id,
    threadId: row.threadId,
    seq: row.seq,
    runId: row.runId,
    depth: row.depth,
    at: row.at,
    type: row.type,
    body: row.body,
    ...(row.parentRunId === null ? {} : { parentRunId: row.parentRunId }),
    ...(row.contextSlot === null ? {} : { contextSlot: row.contextSlot }),
    ...(row.contextKey === null ? {} : { contextKey: row.contextKey }),
    ...(row.contextDigest === null ? {} : { contextDigest: row.contextDigest }),
  }
}

export function toTurnDto(row: TurnModel): TurnDto {
  return {
    runId: row.runId,
    threadId: row.threadId,
    status: row.status,
    providerId: row.providerId,
    modelId: row.modelId,
    steps: row.steps,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMs: row.durationMs,
  }
}
