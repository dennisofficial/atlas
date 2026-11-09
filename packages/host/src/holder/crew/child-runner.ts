import {
  HookChain,
  HookedToolDispatcher,
  LoopTurnRunner,
  type AgentIntake,
} from '@dltech/atlas-agent'
import type { ThreadId } from '@dltech/atlas-core'
import type { PodCrew } from '@dltech/atlas-plugin-sdk'

import { ScopedToolDispatcher } from '../../calls/call-scope'
import type { HeldSessionDeps } from '../held-session-deps'
import { pluginHooksOf, pluginPodContextOf, pluginToolsOf } from '../plugin-pod'
import type { SessionRuntime } from '../ports'
import type { SessionRecord } from '../record/record-adapter'
import { V2OnceLedger } from '../record/v2-once-ledger'
import { retryDepsFromTimers } from '../timer-sleep'
import { DeniedToolRegistry } from './child-tools'

export const childRunnerOf = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  agentId: ThreadId
  signal: AbortSignal
  crew: PodCrew
  intake: AgentIntake
}): LoopTurnRunner => {
  const { deps, runtime, record } = args
  const ctx = pluginPodContextOf({
    deps,
    runtime,
    record,
    threadId: args.agentId,
    signal: args.signal,
    crew: args.crew,
  })
  const registry = new DeniedToolRegistry(
    pluginToolsOf({ runtime, ctx }),
    runtime.plugins?.pod.childDeny ?? [],
  )
  const hooks: HookChain = pluginHooksOf({ runtime, ctx })
  return new LoopTurnRunner({
    record,
    modelContext: record,
    model: runtime.model,
    ids: deps.ids,
    assembly: runtime.assembly,
    hooks,
    tools: () => registry.declarations(),
    dispatch: new ScopedToolDispatcher(new HookedToolDispatcher({ registry, hooks })),
    intake: args.intake,
    launchDirectory: runtime.launchDirectory,
    normalizeFailure: runtime.normalizeFailure,
    retry: retryDepsFromTimers(deps.timers),
    onceLedger: new V2OnceLedger({
      cache: record.eventCache(),
      record,
      threadId: args.agentId,
      runId: () => deps.ids.nextRunId(),
    }),
    ...(deps.log === undefined ? {} : { logPort: deps.log }),
    ...(runtime.uploads === undefined ? {} : { uploads: runtime.uploads }),
    ...(runtime.mediaUrls === undefined ? {} : { mediaUrls: runtime.mediaUrls }),
  })
}
