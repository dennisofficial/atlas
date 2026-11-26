import {
  EModelFallbackReason,
  INBOX_KIND_EVENT,
  TEAMMATE_AGENT_TYPE,
  inboxEventPayloadOf,
  projectDirectoryOfState,
  type EventBody,
  type EventDraft,
  type RecordEvent,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'
import type { PluginPodContext, PodCrew, PodResources } from '@dltech/atlas-plugin-sdk'

import type { InFlightSteps } from '../calls/step-detach'
import { worktreesOf } from './checkouts'
import { derivedIdOf } from './derived-id'
import { modelFellBackDraft } from './crew/model-fell-back'
import type { HeldSessionDeps } from './held-session-deps'
import { EFFECT_RESULT_KIND, effectResultKeyOf, runHostStep, type HostStepFacts } from './host-step'
import { fireLive } from './ports'
import { pluginCallOf } from './plugin-call'
import { podControlOf } from './pod-control'
import { heldMessagesOf } from './pod-messages'
import { reloadResource } from './plugin-resources'
import { podSessionsOf } from './plugin-sessions'
import { analyticsOf, threadKindOf } from './pod-analytics'
import { recordStep, recordedStepsOf } from './record/call-steps'
import type { RoleModelChoice, SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

export type PodStepRunner = {
  run<T>(args: {
    op: string
    input: unknown
    identity?: unknown
    run: (key: string, replayed?: boolean) => Promise<T>
  }): Promise<T>
}

const hostStepFactsOf = (args: {
  record: SessionRecord
  threadId: ThreadId
  runId: () => RunId
}): HostStepFacts => ({
  recorded: (scopeKey) => recordedStepsOf({ record: args.record, scopeKey }),
  record: async (step) =>
    await recordStep({
      record: args.record,
      threadId: args.threadId,
      runId: args.runId(),
      step,
    }),
  result: <T>(stepKey: string) => {
    const found = args.record.eventCache().bookkeeping().fact(effectResultKeyOf(stepKey))
    return found.found ? { found: true, value: found.value as T } : { found: false }
  },
  recordResult: async (stepKey, value) => {
    await args.record.append({
      threadId: args.threadId,
      runId: args.runId(),
      drafts: [
        { type: 'fact-recorded', key: effectResultKeyOf(stepKey), kind: EFFECT_RESULT_KIND, value },
      ],
    })
  },
})

export const podStepRunnerOf = (args: {
  record: SessionRecord
  threadId: ThreadId
  runId: () => RunId
}): PodStepRunner => {
  const facts = hostStepFactsOf(args)
  return { run: (step) => runHostStep({ facts, ...step }) }
}

const crewOf = (args: { crew: PodCrew; step: PodStepRunner }): PodCrew => ({
  ...args.crew,
  spawn: async (spawn) =>
    await args.step.run({
      op: 'host.agent.spawn',
      input: spawn,
      identity: {
        agentType: spawn.agentType,
        intent: spawn.intent,
        group: spawn.group,
        worktree: spawn.worktree,
      },
      run: async (key) => await args.crew.spawn({ ...spawn, agentId: derivedIdOf(`agent:${key}`) }),
    }),
  say: async (said) =>
    await args.step.run({
      op: 'host.agent.say',
      input: said,
      run: async (key) => await args.crew.say({ ...said, clientId: key }),
    }),
  report: async (report) =>
    await args.step.run({
      op: 'host.agent.report',
      input: report,
      run: async (key) => await args.crew.report({ ...report, clientId: key }),
    }),
})

const teammateModelOf =
  (runtime: SessionRuntime): (() => RoleModelChoice) =>
  () =>
    runtime.choiceFor({ role: { agentType: TEAMMATE_AGENT_TYPE }, root: runtime.modelChoice })

const teammateFallbackOf = (args: {
  runtime: SessionRuntime
  append: (drafts: readonly EventDraft[]) => Promise<void>
}): Pick<Parameters<typeof podSessionsOf>[0], 'onFallback'> => ({
  onFallback: async ({ agentId, model }) => {
    if (model.unavailable === undefined) return
    await args.append([
      modelFellBackDraft({
        runtime: args.runtime,
        role: TEAMMATE_AGENT_TYPE,
        agentId,
        from: model.unavailable,
        to: model.ref,
        reason: EModelFallbackReason.ProviderNotConnected,
      }),
    ])
  },
})

const podResourcesOf = (args: {
  runtime: SessionRuntime
  record: SessionRecord
  threadId: ThreadId
  ctx: () => PluginPodContext
}): PodResources => {
  const declared = args.runtime.plugins?.pod.resources ?? []
  return {
    reload: async (name) => {
      const resource = declared.find((candidate) => candidate.name === name)
      if (resource === undefined) return
      const state = await args.record.loopState({ threadId: args.threadId })
      await reloadResource({
        ctx: args.ctx(),
        resource,
        directory: projectDirectoryOfState({
          state,
          launchDirectory: args.runtime.launchDirectory,
        }),
      })
    },
  }
}

const postNoticeToSession = async (args: {
  deps: HeldSessionDeps
  event: EventBody
  key: string
}): Promise<void> => {
  await args.deps.plane.post({
    sessionId: args.deps.sessionId,
    kind: INBOX_KIND_EVENT,
    payload: inboxEventPayloadOf({ event: args.event, clientId: args.key }),
  })
}

export const resolvedEventsOf = (record: SessionRecord): readonly RecordEvent[] => {
  const cache = record.eventCache()
  return cache.eventsAfter(0).map((event) => cache.resolvedEvent(event))
}

export const pluginPodContextOf = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  threadId: ThreadId
  signal: AbortSignal
  crew: PodCrew
  selfAgentId?: string | undefined
  steps?: InFlightSteps | undefined
  notify?: ((event: EventBody, options: { key: string }) => Promise<void>) | undefined
}): PluginPodContext => {
  const { deps, runtime, record, threadId } = args
  const append = async (drafts: readonly EventDraft[]): Promise<void> => {
    await record.append({ threadId, runId: deps.ids.nextRunId(), drafts })
  }
  const step = podStepRunnerOf({ record, threadId, runId: () => deps.ids.nextRunId() })
  const ctx: PluginPodContext = {
    sessionId: deps.sessionId,
    workspaceDirectory: runtime.launchDirectory,
    control: podControlOf({
      client: deps.control,
      threadId,
      step,
      ...(deps.mcp === undefined ? {} : { mcp: deps.mcp(deps.sessionId) }),
    }),
    crew: crewOf({ crew: args.crew, step }),
    messages: heldMessagesOf({ deps, crew: args.crew, selfAgentId: args.selfAgentId, step }),
    classifier: {
      status: () => runtime.classifierStatus,
      classify: (args) => runtime.classifier.classify(args),
    },
    analytics: analyticsOf({
      analytics: runtime.analytics,
      sessionId: deps.sessionId,
      threadId,
      threadKind: threadKindOf({ selfAgentId: args.selfAgentId, agents: args.crew.list() }),
    }),
    sessions: podSessionsOf({
      plane: deps.plane,
      sessionId: deps.sessionId,
      step,
      model: teammateModelOf(runtime),
      ...teammateFallbackOf({ runtime, append }),
      parkArchived: deps.parkArchived,
    }),
    worktrees: worktreesOf({
      calls: runtime.remoteCalls,
      ...(runtime.workspaceGate === undefined ? {} : { gate: runtime.workspaceGate }),
    }),
    append,
    notify: async (event, options) =>
      await (args.notify === undefined
        ? postNoticeToSession({ deps, event, key: options.key })
        : args.notify(event, options)),
    events: () => resolvedEventsOf(record),
    call: pluginCallOf({
      invoke: (call) => runtime.remoteCalls.invoke(call),
      ...(runtime.env === undefined ? {} : { env: runtime.env }),
      ...(runtime.workspaceGate === undefined ? {} : { gate: runtime.workspaceGate }),
      steps: {
        recorded: (scopeKey) => recordedStepsOf({ record, scopeKey }),
        record: (stepRecord) =>
          recordStep({ record, threadId, runId: deps.ids.nextRunId(), step: stepRecord }),
      },
      bootId: () => runtime.remoteCalls.bootId(),
      ack: (key) => runtime.remoteCalls.ack({ key }),
      ...(args.steps === undefined ? {} : { onStep: (event) => args.steps?.apply(event) }),
    }),
    live: (frame) => fireLive({ bus: deps.bus, key: deps.sessionId, frame }),
    onDaemonEvent: (listener) => {
      const off = runtime.remoteCalls.onEvent(listener)
      args.signal.addEventListener('abort', off, { once: true })
      return off
    },
    daemonCapabilities: () => runtime.remoteCalls.daemonCapabilities(),
    log: (message) => deps.log?.info({ source: 'holder.plugin', message }),
    resources: podResourcesOf({ runtime, record, threadId, ctx: () => ctx }),
    ...(runtime.env === undefined ? {} : { env: runtime.env }),
  }
  return ctx
}
