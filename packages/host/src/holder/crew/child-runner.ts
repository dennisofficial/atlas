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
import {
  pluginHooksOf,
  pluginPodContextOf,
  pluginToolsOf,
  resolvedEventsOf,
  resourceSyncOf,
} from '../plugin-pod'
import { hookedToolsOf } from '../hooked-tools'
import { liveOutputOf } from '../live-output'
import { modelWaitObserverOf } from '../model-wait-observer'
import type { RoleModelChoice, SessionRuntime } from '../ports'
import type { SessionRecord } from '../record/record-adapter'
import { RecordOnceLedger } from '../record/record-once-ledger'
import { retryDepsFromTimers } from '../timer-sleep'
import { childModelOf } from './child-model'
import { DeniedToolRegistry } from './child-tools'

export const childRunnerOf = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  parentThreadId: ThreadId
  agentId: ThreadId
  epoch: number
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
    selfAgentId: args.agentId,
    notify: (event, options) => args.notify(event, options),
  })
  const registry = new DeniedToolRegistry(
    pluginToolsOf({ runtime, ctx }),
    runtime.plugins?.pod.childDeny ?? [],
  )
  const sync = resourceSyncOf({
    runtime,
    ctx,
    record: args.parentRecord,
    signal: args.signal,
    shared: () => resolvedEventsOf(args.parentRecord),
  })
  const hooks: HookChain = pluginHooksOf({
    runtime,
    ctx,
    declarations: () => registry.declarations(),
    ...(sync === undefined ? {} : { sync }),
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
    dispatch: new ScopedToolDispatcher(
      hookedToolsOf({
        registry,
        hooks,
        trace: runtime.trace,
      }),
    ),
    intake: args.intake,
    output: liveOutputOf({
      bus: deps.bus,
      liveKey: args.agentId,
      timers: deps.timers,
      headSeq: () => record.eventCache().currentHead().seq,
      epoch: args.epoch,
    }),
    detachTool: (tool) => args.isDraining() && runtime.daemonTools.has(tool),
    launchDirectory: runtime.launchDirectory,
    normalizeFailure: runtime.normalizeFailure,
    retry: retryDepsFromTimers(deps.timers),
    onceLedger: new RecordOnceLedger({
      cache: record.eventCache(),
      record,
      threadId: args.agentId,
      runId: () => deps.ids.nextRunId(),
    }),
    waitState: modelWaitObserverOf({
      record: args.parentRecord,
      threadId: args.parentThreadId,
      newRunId: () => deps.ids.nextRunId(),
      ...(deps.log === undefined ? {} : { log: deps.log }),
    }),
    ...(deps.log === undefined ? {} : { logPort: deps.log }),
    ...(runtime.uploads === undefined ? {} : { uploads: runtime.uploads }),
    ...(runtime.mediaUrls === undefined ? {} : { mediaUrls: runtime.mediaUrls }),
  })
}
