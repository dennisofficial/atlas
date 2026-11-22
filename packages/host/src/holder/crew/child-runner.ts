import { HookChain, LoopTurnRunner, type AgentIntake } from '@dltech/atlas-agent'
import {
  modelFacingDeclarationsOf,
  type EventBody,
  type ThreadId,
  type ModelRef,
} from '@dltech/atlas-core'
import type { PodCrew } from '@dltech/atlas-plugin-sdk'

import { ScopedToolDispatcher } from '../../calls/call-scope'
import type { HeldSessionDeps } from '../held-session-deps'
import { pluginHooksOf, pluginPodContextOf, pluginToolsOf, resolvedEventsOf } from '../plugin-pod'
import { hookedToolsOf } from '../hooked-tools'
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
  parentRecord: SessionRecord
  intake: AgentIntake
  notify(event: EventBody, options: { key: string }): Promise<void>
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
    notify: (event, options) => args.notify(event, options),
  })
  const registry = new DeniedToolRegistry(
    pluginToolsOf({ runtime, ctx }),
    runtime.plugins?.pod.childDeny ?? [],
  )
  const hooks: HookChain = pluginHooksOf({
    runtime,
    ctx,
    declarations: () => registry.declarations(),
    sharedEvents: () => resolvedEventsOf(args.parentRecord),
  })
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
    tools: () => modelFacingDeclarationsOf(registry.declarations()),
    dispatch: new ScopedToolDispatcher(hookedToolsOf({ registry, hooks, trace: runtime.trace })),
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
