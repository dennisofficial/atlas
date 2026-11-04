import type { ThreadId } from '@dltech/atlas-core'
import { HookChain, HookedToolDispatcher, LoopTurnRunner } from '@dltech/atlas-agent'

import { ScopedToolDispatcher } from '../calls/call-scope'
import type { HeldSessionDeps } from './held-session-deps'
import type { HeldTurns } from './held-turns'
import type { InboxIntake } from './inbox-intake'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'
import { V2OnceLedger } from './record/v2-once-ledger'
import { retryDepsFromTimers } from './timer-sleep'

export const createLoopRunner = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  intake: InboxIntake
  turns: HeldTurns
  threadId: ThreadId
  isModelOnlyDrain(): boolean
}): LoopTurnRunner => {
  const { deps, runtime, record, intake, threadId } = args
  return new LoopTurnRunner({
    record,
    modelContext: record,
    model: runtime.model,
    ids: deps.ids,
    assembly: runtime.assembly,
    tools: () => runtime.tools.declarations(),
    dispatch: new ScopedToolDispatcher(
      new HookedToolDispatcher({ registry: runtime.tools, hooks: new HookChain({}) }),
    ),
    intake,
    output: args.turns.liveOutput(),
    detachTool: (tool) => args.isModelOnlyDrain() && runtime.daemonTools.has(tool),
    launchDirectory: runtime.launchDirectory,
    normalizeFailure: runtime.normalizeFailure,
    retry: retryDepsFromTimers(deps.timers),
    onceLedger: new V2OnceLedger({
      cache: record.eventCache(),
      record,
      threadId,
      runId: () => deps.ids.nextRunId(),
    }),
  })
}
