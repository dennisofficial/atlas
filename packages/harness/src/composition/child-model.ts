import {
  capabilitiesFromCatalog,
  EFFORT_LADDER,
  EModelFallbackReason,
  ENoticeTone,
  ERunFailureKind,
  EStalePolicy,
  modelFallbackCopy,
  NOTICE_WARN_MS,
  parseRef,
  providerLabelOf,
  refKey,
  resolveModelChoice,
  unavailableModelMessage,
  type EventLogPort,
  type IdPort,
  type ModelChoice,
  type ModelPort,
  type ModelRef,
  type NoticePort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentType } from '../agents/types'
import type { ModelFallback } from '../agents/registry/open-child'
import type { HookChain } from '../hooks/registry'
import { AiSdkModelPort } from '../model/ai-sdk-model-port'
import { reachableModel } from '../model/reachable-model'
import { TurnFault } from '../model/turn-fault'
import type { SettingsService } from '../settings/service'
import type { ThreadModel, ThreadStorePort, ThreadSummary } from '../store/thread-store'
import { childFallbackModel } from './child-fallback-model'
import { DEFAULT_MODEL_REF } from './config'
import { faultInjected } from './fault-injection'
import { unanswerableRef, type ModelCatalogue } from './model-catalogue'
import { settingReaderOf } from './model-preference'
import type { ModelSelection, SelectableModel } from './model-selection'
import type { WakeSignal } from '../wake/wake-signals'

export type ChildModelDeps = {
  models: ModelCatalogue
  model: SelectableModel
  hooks: () => HookChain
  settings: SettingsService
  threads: ThreadStorePort
  notice?: NoticePort | undefined
  wake?: WakeSignal | undefined
  log?: EventLogPort | undefined
  ids?: IdPort | undefined
}

export type ChildSelection = {
  model: ThreadModel
  fellBack?: ModelFallback | undefined
}

/**
 * A child spawned by an agent inherits that agent's frozen model, so nested children keep the
 * chain; one spawned by the operator inherits the model answering right now.
 */
const rootChoice = (args: {
  live: ModelSelection
  spawner: ThreadSummary | undefined
}): ModelChoice => {
  const inherited = args.spawner?.agent === undefined ? undefined : args.spawner.model
  const ref = parseRef(inherited?.ref ?? '')
  const effort = EFFORT_LADDER.find((rung) => rung === inherited?.effort)
  if (inherited === undefined || ref === undefined || effort === undefined)
    return { ref: args.live.ref, effort: args.live.effort, fast: args.live.fast === true }

  return { ref, effort, fast: (inherited.fast ?? args.live.fast) === true }
}

const labelOf = (args: { models: ModelCatalogue; ref: ModelRef }): string =>
  args.models.cardFor(args.ref)?.label ?? args.ref.modelId

const fallbackOf = (args: {
  models: ModelCatalogue
  role: string
  from: ModelRef
  to: ModelRef
  reason: EModelFallbackReason
}): ModelFallback => ({
  role: args.role,
  from: { ref: refKey(args.from), label: labelOf({ models: args.models, ref: args.from }) },
  to: { ref: refKey(args.to), label: labelOf({ models: args.models, ref: args.to }) },
  reason: args.reason,
})

export function childModelSelection(
  args: ChildModelDeps,
): (request: { agentType: AgentType; spawnedBy: ThreadId }) => Promise<ChildSelection> {
  return async ({ agentType, spawnedBy }) => {
    const live = args.model.choice()
    const spawner = await args.threads.find({ threadId: spawnedBy })
    const choice = resolveModelChoice({
      role: { agentType: agentType.name },
      read: settingReaderOf(args.settings.snapshot().resolution),
      capabilitiesOf: capabilitiesFromCatalog({
        catalog: args.models.catalog,
        reachable: args.models.reachable,
      }),
      fallback: DEFAULT_MODEL_REF,
      root: rootChoice({ live, spawner }),
      pinned: () => agentType.model,
      stale: EStalePolicy.Follow,
    })
    const model = {
      ref: refKey(choice.ref),
      effort: choice.effort,
      ...(choice.fast ? { fast: true } : {}),
    }
    if (choice.unavailable === undefined) return { model }

    return {
      model,
      fellBack: fallbackOf({
        models: args.models,
        role: agentType.name,
        from: choice.unavailable,
        to: choice.ref,
        reason: EModelFallbackReason.ProviderNotConnected,
      }),
    }
  }
}

async function savedChildModel(args: {
  deps: ChildModelDeps
  agentType: AgentType
  threadId: ThreadId
}): Promise<{ model: ThreadModel; spawnedBy: ThreadId | undefined }> {
  const { deps, agentType, threadId } = args
  const thread = await deps.threads.find({ threadId })
  if (thread === undefined) throw new Error(`no child thread named ${threadId}`)
  if (thread.model !== undefined) return { model: thread.model, spawnedBy: thread.agent?.spawnedBy }

  const chosen = await childModelSelection(deps)({
    agentType,
    spawnedBy: thread.agent?.spawnedBy ?? threadId,
  })
  try {
    await deps.threads.chooseModel({ threadId, model: chosen.model })
  } catch (error) {
    const concurrent = await deps.threads.find({ threadId })
    if (concurrent?.model !== undefined)
      return { model: concurrent.model, spawnedBy: concurrent.agent?.spawnedBy }
    throw error
  }
  const saved = await deps.threads.find({ threadId })
  if (saved?.model === undefined) throw new Error(`could not save the model for child ${threadId}`)
  return { model: saved.model, spawnedBy: saved.agent?.spawnedBy }
}

const portFor = (args: {
  deps: ChildModelDeps
  ref: ModelRef
  effort: (typeof EFFORT_LADDER)[number]
  fast: boolean
  subject: string
}): ModelPort => {
  const card = args.deps.models.cardFor(args.ref)
  const adapter = args.deps.models.adapterFor(args.ref.providerId)
  if (card === undefined || adapter === undefined) throw unanswerableRef(refKey(args.ref))

  const providerLabel = providerLabelOf(args.ref.providerId) ?? args.ref.providerId
  return faultInjected(
    new AiSdkModelPort({
      model: reachableModel({
        model: adapter.model({ card, effort: () => args.effort, fast: () => args.fast }),
        fault: () =>
          args.deps.models.reachable(args.ref.providerId)
            ? undefined
            : new TurnFault({
                kind: ERunFailureKind.MissingCredential,
                message: unavailableModelMessage({
                  subject: args.subject,
                  modelLabel: card.label,
                  providerLabel,
                }),
              }),
      }),
      card,
      hooks: args.deps.hooks(),
      ...(args.deps.wake === undefined ? {} : { wake: args.deps.wake }),
    }),
  )
}

/**
 * The model a child falls back to when its own credential is dead: the session model the operator
 * is running right now, resolved lazily so a mid-session switch is followed. Absent when the
 * child already runs that model — there is nowhere to fall to.
 */
const parentModelFor = (
  args: ChildModelDeps,
  childRef: ModelRef,
): (() => ModelPort | undefined) => {
  return () => {
    const choice = args.model.choice()
    if (refKey(choice.ref) === refKey(childRef)) return undefined
    return portFor({
      deps: args,
      ref: choice.ref,
      effort: choice.effort,
      fast: choice.fast === true,
      subject: 'Your main agent',
    })
  }
}

export function childModelSource(
  args: ChildModelDeps,
): (request: { agentType: AgentType; threadId: ThreadId }) => Promise<ModelPort> {
  return async ({ agentType, threadId }) => {
    const saved = await savedChildModel({ deps: args, agentType, threadId })
    const ref = parseRef(saved.model.ref)
    const effort = EFFORT_LADDER.find((value) => value === saved.model.effort)
    if (ref === undefined || effort === undefined)
      throw new Error(`invalid saved model selection for child ${threadId}`)

    const port = portFor({
      deps: args,
      ref,
      effort,
      fast: saved.model.fast === true,
      subject: `${agentType.name}'s model`,
    })
    return childFallbackModel({
      primary: port,
      parentFor: parentModelFor(args, ref),
      onFallback: () => {
        const body = {
          type: 'model-fell-back' as const,
          agentId: threadId,
          ...fallbackOf({
            models: args.models,
            role: agentType.name,
            from: ref,
            to: args.model.choice().ref,
            reason: EModelFallbackReason.CredentialFailed,
          }),
        }
        if (args.log !== undefined && args.ids !== undefined)
          void args.log.append({
            threadId: saved.spawnedBy ?? threadId,
            runId: args.ids.nextRunId(),
            drafts: [body],
          })
        args.notice?.notify({
          key: `child-fallback:${threadId}`,
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
          text: modelFallbackCopy(body).title,
        })
      },
    })
  }
}
