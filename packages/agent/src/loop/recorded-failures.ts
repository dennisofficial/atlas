import { runFailureWith, type NormalizeFailure } from '../model/run-failure'
import type { RunFailure, RunId, ThreadId } from '@dltech/atlas-core'

import type { AgentRecordPort } from '../record/agent-record.port'

const recordedFailures = new WeakSet<object>()

export const markFailureRecorded = (error: unknown): void => {
  if (typeof error === 'object' && error !== null) recordedFailures.add(error)
}

export const failureRecorded = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && recordedFailures.has(error)

export async function recordRunFailure(args: {
  record: AgentRecordPort
  threadId: ThreadId
  runId: RunId
  failure: RunFailure
}): Promise<void> {
  try {
    await args.record.append({
      threadId: args.threadId,
      runId: args.runId,
      drafts: [{ type: 'run-failed', failure: args.failure }],
    })
  } catch (error) {
    markFailureRecorded(error)
    throw error
  }
}

export async function recordEscapedFailure(args: {
  record: AgentRecordPort
  threadId: ThreadId
  runId: RunId
  error: unknown
  identity: { id: string; modelId: string }
  normalizeFailure: NormalizeFailure
}): Promise<void> {
  if (failureRecorded(args.error)) return
  const { error } = args
  await recordRunFailure({
    record: args.record,
    threadId: args.threadId,
    runId: args.runId,
    failure: runFailureWith({
      normalize: args.normalizeFailure,
      message: error instanceof Error ? error.message : String(error),
      cause: error,
      escaped: true,
      providerId: args.identity.id,
      modelId: args.identity.modelId,
    }),
  }).catch(() => undefined)
  markFailureRecorded(error)
}
