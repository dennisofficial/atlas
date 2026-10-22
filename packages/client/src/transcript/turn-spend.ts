import type { RunId, ThreadId } from '@dltech/atlas-core'

export type TurnSpend = {
  runId: RunId
  threadId: ThreadId
  status: string
  providerId: string
  modelId: string
  steps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  startedAt: string
  endedAt: string
  durationMs: number
}
