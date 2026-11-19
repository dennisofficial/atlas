import {
  HookChain,
  HookedToolDispatcher,
  LoopTurnRunner,
  type AgentIntake,
} from '@dltech/atlas-agent'
import type { ThreadId, ModelRef } from '@dltech/atlas-core'
import type { PodCrew } from '@dltech/atlas-plugin-sdk'

import { ScopedToolDispatcher } from '../../calls/call-scope'
import type { HeldSessionDeps } from '../held-session-deps'
import { pluginHooksOf, pluginPodContextOf, pluginToolsOf } from '../plugin-pod'
import type { RoleModelChoice, SessionRuntime } from '../ports'
import type { SessionRecord } from '../record/record-adapter'
import { V2OnceLedger } from '../record/v2-once-ledger'
import { retryDepsFromTimers } from '../timer-sleep'
import { childModelOf } from './child-model'
import { DeniedToolRegistry } from './child-tools'

export const childRunnerOf = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  agentId: ThreadId
  model: RoleModelChoice
  signal: AbortSignal
  crew: PodCrew
  intake: AgentIntake
  isDraining(): boolean
  onFallback?: ((refs: { from: ModelRef; to: ModelRef }) => void | Promise<void>) | undefined
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
    ...(runtime.trace === undefined ? {} : { trace: runtime.trace }),
    model: childModelOf({
      runtime,
      model: args.model,
      ...(args.onFallback === undefined ? {} : { onFallback: args.onFallback }),
    }),
    ids: deps.ids,
    assembly: runtime.assembly,
    hooks,
    tools: () => registry.declarations(),
    dispatch: new ScopedToolDispatcher(new HookedToolDispatcher({ registry, hooks })),
    intake: args.intake,
    detachTool: (tool) => args.isDraining() && runtime.daemonTools.has(tool),
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
