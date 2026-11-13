import type { HeldSessionDeps } from './held-session-deps'
import { operatorAnswersOf } from './operator-answer'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

export const settleOperatorOnStop = async (args: {
  deps: HeldSessionDeps
  record: SessionRecord | undefined
  runtime: SessionRuntime | undefined
}): Promise<void> => {
  const { deps, record, runtime } = args
  const requests = deps.operator?.(deps.sessionId)
  if (record === undefined || runtime === undefined || requests === undefined) return
  await operatorAnswersOf({
    requests,
    calls: runtime.remoteCalls,
    sessionId: deps.sessionId,
    threadId: record.threadId,
    sessionDir: deps.sessionDir,
    record,
    newRunId: () => deps.ids.nextRunId(),
  }).cancelOpen({ reason: 'the session was stopped while the request was open' })
}
