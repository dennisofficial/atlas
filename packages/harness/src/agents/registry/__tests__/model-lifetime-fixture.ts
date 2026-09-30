import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'

import {
  defaultPipeline,
  EEffort,
  EImageTier,
  EMPTY_PROMPT,
  type ModelCard,
  type ModelRef,
  type ThreadId,
} from '@dltech/atlas-core'

import { createDeltaChannel } from '../../../channel/delta-channel'
import {
  CLAUDE,
  GPT,
  recordingCatalogue,
  type BuiltModel,
} from '../../../composition/__tests__/child-model-fixtures'
import { childModelSelection, childModelSource } from '../../../composition/child-model'
import { selectableModel, type SelectableModel } from '../../../composition/model-selection'
import { HookChain } from '../../../hooks/registry'
import { buildHarness } from '../../../loop/build-harness'
import { createTempHome } from '../../../loop/__tests__/temp-home'
import { providerPartsFor, scriptedModel, type ScriptedStep } from '../../../model/testing/scripted-model'
import type { ProviderAdapter } from '../../../providers/adapter'
import { MemorySettingsStore } from '../../../settings/memory-store'
import { createSettingsService } from '../../../settings/service'
import type { ThreadModel } from '../../../store/thread-store'
import { InMemoryToolRegistry } from '../../../tools/registry'
import type { AgentType } from '../../types'
import { childRunnerSource, type ChildRunnerDeps } from '../child-runner'
import { AgentSupervisor } from '../supervisor'

export const LAUNCH = '/launch'

export type LifetimeAdapter = ProviderAdapter & {
  built: BuiltModel[]
  mock: MockLanguageModelV4
  setScript: (script: readonly ScriptedStep[]) => void
}

function lifetimeAdapter(args: { ref: ModelRef }): LifetimeAdapter {
  const built: BuiltModel[] = []
  const steps: ScriptedStep[] = []
  const mock = new MockLanguageModelV4({
    provider: args.ref.providerId,
    modelId: args.ref.modelId,
    doStream: async () => {
      const step = steps.shift()
      if (step === undefined) throw new Error(`${args.ref.providerId} ran out of scripted steps`)
      return {
        stream: simulateReadableStream({
          chunks: providerPartsFor(step),
          initialDelayInMs: 0,
          chunkDelayInMs: 0,
        }),
      }
    },
  })

  return {
    id: args.ref.providerId,
    label: args.ref.providerId,
    built,
    mock,
    setScript: (script) => {
      steps.splice(0, steps.length, ...script)
    },
    cards: () => [lifetimeCard(args.ref)],
    model: ({ effort }) => {
      built.push({ model: mock, effortAt: () => effort() })
      return mock
    },
    effortOptions: () => undefined,
  }
}

function lifetimeCard(ref: ModelRef): ModelCard {
  return {
    ref,
    label: ref.modelId,
    api: 'messages',
    contextWindow: 200_000,
    imageTier: EImageTier.HighResolution,
    cost: { inputPerMillion: 1, outputPerMillion: 2 },
    effort: { [EEffort.Low]: 'low', [EEffort.Medium]: 'medium', [EEffort.High]: 'high' },
  }
}

export type LifetimeOpened = {
  supervisor: AgentSupervisor
  main: ThreadId
  adapters: { anthropic: LifetimeAdapter; openai: LifetimeAdapter }
  parent: SelectableModel
  persistedBeforeBuild: ThreadId[]
  savedModel: (threadId: ThreadId) => Promise<ThreadModel | undefined>
  close: () => Promise<void>
}

export async function openLifetimeSupervisor(args: {
  agentTypes: readonly AgentType[]
  assemblyFor: ChildRunnerDeps['assemblyFor']
}): Promise<LifetimeOpened> {
  const temp = createTempHome()
  const harness = await buildHarness({ home: temp.home, model: scriptedModel({ script: [] }) })

  const adapters = {
    anthropic: lifetimeAdapter({ ref: CLAUDE }),
    openai: lifetimeAdapter({ ref: GPT }),
  }
  const models = recordingCatalogue([adapters.anthropic, adapters.openai])

  const parent = selectableModel({
    catalogue: models,
    initial: { ref: CLAUDE, effort: EEffort.Medium },
  })

  const settings = createSettingsService({
    definitions: [],
    user: new MemorySettingsStore({ document: { values: {} } }),
  })

  const deps = {
    models,
    model: parent,
    hooks: () => new HookChain({}),
    settings,
    threads: harness.threads,
  }
  const selection = childModelSelection(deps)
  const source = childModelSource(deps)

  const persistedBeforeBuild: ThreadId[] = []
  const runners = childRunnerSource({
    deps: () => ({
      turn: {
        log: harness.log,
        model: harness.model,
        ids: harness.ids,
        assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: LAUNCH }),
        launchDirectory: LAUNCH,
      },
      tools: new InMemoryToolRegistry([]),
      hooks: new HookChain({}),
      channel: createDeltaChannel(),
      drainNotices: async () => ({ drafts: [], wakesTurn: false }),
      modelFor: async (request) => {
        const thread = await harness.threads.find({ threadId: request.threadId })
        if (thread?.model !== undefined) persistedBeforeBuild.push(request.threadId)
        return source(request)
      },
      assemblyFor: args.assemblyFor,
    }),
  })

  const supervisor = new AgentSupervisor({
    log: harness.log,
    threads: harness.threads,
    ids: harness.ids,
    clock: harness.clock,
    agentTypes: args.agentTypes,
    runners,
    modelAtSpawn: selection,
    launchDirectory: LAUNCH,
  })

  const main = (await harness.threads.create({ title: 'lifetime main' })).id

  return {
    supervisor,
    main,
    adapters,
    parent,
    persistedBeforeBuild,
    savedModel: async (threadId) => (await harness.threads.find({ threadId }))?.model,
    close: async () => {
      await harness.close()
      temp.discard()
    },
  }
}
