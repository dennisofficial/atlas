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
  const operator = deps.operator
  if (record === undefined || runtime === undefined || operator === undefined) return
  await operatorAnswersOf({
    calls: runtime.remoteCalls,
    sessionId: deps.sessionId,
    threadId: record.threadId,
    sessionDir: operator.sessionDir,
    openValue: operator.openValue,
    record,
    newRunId: () => deps.ids.nextRunId(),
  }).cancelOpen({ reason: 'the session was stopped while the request was open' })
}
