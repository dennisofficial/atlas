import { runFailureOf } from '../model/run-failure'
import type { EventLogPort, RunFailure, RunId, ThreadId } from '@dltech/atlas-core'

const recordedFailures = new WeakSet<object>()

export const markFailureRecorded = (error: unknown): void => {
  if (typeof error === 'object' && error !== null) recordedFailures.add(error)
}

export const failureRecorded = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && recordedFailures.has(error)

export async function recordRunFailure(args: {
  log: EventLogPort
  threadId: ThreadId
  runId: RunId
  failure: RunFailure
}): Promise<void> {
  try {
    await args.log.append({
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
  log: EventLogPort
  threadId: ThreadId
  runId: RunId
  error: unknown
  identity: { id: string; modelId: string }
}): Promise<void> {
  if (failureRecorded(args.error)) return
  const { error } = args
  await recordRunFailure({
    log: args.log,
    threadId: args.threadId,
    runId: args.runId,
    failure: runFailureOf({
      message: error instanceof Error ? error.message : String(error),
      cause: error,
      escaped: true,
      providerId: args.identity.id,
      modelId: args.identity.modelId,
    }),
  }).catch(() => undefined)
  markFailureRecorded(error)
}
