import {
  agentTypeSettingId,
  EFFORT_LADDER,
  ESettingId,
  parseRef,
  refKey,
  textValueOf,
  toggleValueOf,
  type ModelPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentType } from '../agents/types'
import type { HookChain } from '../hooks/registry'
import { AiSdkModelPort } from '../model/ai-sdk-model-port'
import type { SettingsService } from '../settings/service'
import type { ThreadModel, ThreadStorePort } from '../store/thread-store'
import { faultInjected } from './fault-injection'
import { isRefReachable, unanswerableRef, type ModelCatalogue } from './model-catalogue'
import type { SelectableModel } from './model-selection'
import type { WakeSignal } from '../wake/wake-signals'

export type ChildModelDeps = {
  models: ModelCatalogue
  model: SelectableModel
  hooks: () => HookChain
  settings: SettingsService
  threads: ThreadStorePort
  wake?: WakeSignal | undefined
}

export function childModelSelection(args: ChildModelDeps): (request: {
  agentType: AgentType
  spawnedBy: ThreadId
}) => Promise<ThreadModel> {
  const liveSetting = (id: string): string | undefined => {
    const held = textValueOf({ resolution: args.settings.snapshot().resolution, id })
    const ref = parseRef(held)
    return ref !== undefined && isRefReachable({ catalogue: args.models, ref }) ? held : undefined
  }

  return async ({ agentType, spawnedBy }) => {
    const parent = args.model.choice()
    const pinned =
      liveSetting(agentTypeSettingId(agentType.name)) ??
      agentType.model ??
      liveSetting(ESettingId.SubagentModel)
    const spawner = await args.threads.find({ threadId: spawnedBy })
    const inherited = spawner?.agent === undefined ? undefined : spawner.model
    return {
      ref: pinned ?? inherited?.ref ?? refKey(parent.ref),
      effort: inherited?.effort ?? parent.effort,
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

export function childModelSource(args: ChildModelDeps): (request: {
  agentType: AgentType
  threadId: ThreadId
}) => Promise<ModelPort> {
  return async ({ agentType, threadId }) => {
    const saved = await savedChildModel({ deps: args, agentType, threadId })
    const ref = parseRef(saved.ref)
    const effort = EFFORT_LADDER.find((value) => value === saved.effort)
    if (ref === undefined || effort === undefined)
      throw new Error(`invalid saved model selection for child ${threadId}`)

    const card = args.models.cardFor(ref)
    const adapter = args.models.adapterFor(ref.providerId)
    if (card === undefined || adapter === undefined) throw unanswerableRef(refKey(ref))

    const port = faultInjected(new AiSdkModelPort({
      model: adapter.model({ card, effort: () => effort }),
      card,
      hooks: args.hooks(),
      ...(args.wake === undefined ? {} : { wake: args.wake }),
      inputCapWorkaround: () =>
        toggleValueOf({
          resolution: args.settings.snapshot().resolution,
          id: ESettingId.MultimodalCapWorkaround,
        }),
    }))
    return port
  }
}
