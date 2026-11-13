import {
  capabilitiesFromCatalog,
  EFFORT_LADDER,
  ENoticeTone,
  EStalePolicy,
  NOTICE_WARN_MS,
  parseRef,
  refKey,
  resolveModelChoice,
  type ModelChoice,
  type ModelPort,
  type ModelRef,
  type NoticePort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentType } from '../agents/types'
import type { HookChain } from '../hooks/registry'
import { AiSdkModelPort } from '../model/ai-sdk-model-port'
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

export function childModelSelection(
  args: ChildModelDeps,
): (request: { agentType: AgentType; spawnedBy: ThreadId }) => Promise<ThreadModel> {
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
    return {
      ref: refKey(choice.ref),
      effort: choice.effort,
      ...(choice.fast ? { fast: true } : {}),
    }
  }
}

async function savedChildModel(args: {
  deps: ChildModelDeps
  agentType: AgentType
  threadId: ThreadId
}): Promise<ThreadModel> {
  const { deps, agentType, threadId } = args
  const thread = await deps.threads.find({ threadId })
  if (thread === undefined) throw new Error(`no child thread named ${threadId}`)
  if (thread.model !== undefined) return thread.model

  const chosen = await childModelSelection(deps)({
    agentType,
    spawnedBy: thread.agent?.spawnedBy ?? threadId,
  })
  try {
    await deps.threads.chooseModel({ threadId, model: chosen })
  } catch (error) {
    const concurrent = await deps.threads.find({ threadId })
    if (concurrent?.model !== undefined) return concurrent.model
    throw error
  }
  const saved = await deps.threads.find({ threadId })
  if (saved?.model === undefined) throw new Error(`could not save the model for child ${threadId}`)
  return saved.model
}

const portFor = (
  args: ChildModelDeps,
  ref: ModelRef,
  effort: (typeof EFFORT_LADDER)[number],
  fast: boolean,
): ModelPort => {
  const card = args.models.cardFor(ref)
  const adapter = args.models.adapterFor(ref.providerId)
  if (card === undefined || adapter === undefined) throw unanswerableRef(refKey(ref))

  return faultInjected(
    new AiSdkModelPort({
      model: adapter.model({ card, effort: () => effort, fast: () => fast }),
      card,
      hooks: args.hooks(),
      ...(args.wake === undefined ? {} : { wake: args.wake }),
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
    return portFor(args, choice.ref, choice.effort, choice.fast === true)
  }
}

export function childModelSource(
  args: ChildModelDeps,
): (request: { agentType: AgentType; threadId: ThreadId }) => Promise<ModelPort> {
  return async ({ agentType, threadId }) => {
    const saved = await savedChildModel({ deps: args, agentType, threadId })
    const ref = parseRef(saved.ref)
    const effort = EFFORT_LADDER.find((value) => value === saved.effort)
    if (ref === undefined || effort === undefined)
      throw new Error(`invalid saved model selection for child ${threadId}`)

    const port = portFor(args, ref, effort, saved.fast === true)
    return childFallbackModel({
      primary: port,
      parentFor: parentModelFor(args, ref),
      onFallback: (fault) => {
        const parent = args.model.choice()
        args.notice?.notify({
          key: `child-fallback:${threadId}`,
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
          text: `${agentType.name} hit a dead credential on ${ref.providerId} — switched to your session model ${parent.ref.modelId}. ${messageOf(fault)}`,
        })
      },
    })
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
