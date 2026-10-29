import type { Row } from '@dltech/atlas-db'
import type { EventDto, ThreadDto, TurnDto } from './sessions.types'

export function toThreadDto({
  thread: row,
  session,
}: {
  thread: Row<'Thread'>
  session: Row<'Session'>
}): ThreadDto {
  return {
    id: row.id,
    sessionId: row.sessionId,
    head: row.head,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    workspace: session.workspace,
    repo: session.repo,
    ...(session.title === null ? {} : { title: session.title }),
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
    ...(session.executionLocation === null ? {} : { executionLocation: session.executionLocation }),
    projectId: session.projectId,
    pinnedAt: session.pinnedAt === null ? null : session.pinnedAt.toISOString(),
    archivedAt: session.archivedAt === null ? null : session.archivedAt.toISOString(),
  }
}

export function toEventDto(row: Row<'Event'>): EventDto {
  return {
    id: row.id,
    threadId: row.threadId,
    seq: row.seq,
    runId: row.runId,
    depth: row.depth,
    at: row.at.toISOString(),
    type: row.type,
    body: row.body,
    ...(row.parentRunId === null ? {} : { parentRunId: row.parentRunId }),
    ...(row.contextSlot === null ? {} : { contextSlot: row.contextSlot }),
    ...(row.contextKey === null ? {} : { contextKey: row.contextKey }),
    ...(row.contextDigest === null ? {} : { contextDigest: row.contextDigest }),
  }
}

export function toTurnDto(row: Row<'Turn'>): TurnDto {
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
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt.toISOString(),
    durationMs: row.durationMs,
  }
}
