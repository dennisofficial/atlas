import {
  agentTypeSettingId,
  ANTHROPIC_PROVIDER_ID,
  ESettingId,
  parseRef,
  textValueOf,
  type Account,
  type CredentialPort,
  type ModelPort,
  type NoticePort,
  type SettingsResolution,
} from '@dltech/atlas-core'

import { pinnedModelSource } from '../agents/types/pinned-model'
import type { DependencyContainer } from '../container/injection'
import { DockerEngineToken, LanguageModelToken, ModelCardSourceToken } from '../container/tokens'
import type { HookChain } from '../hooks/registry'
import { AiSdkModelPort } from '../model/ai-sdk-model-port'
import { cardsForProvider } from '../models/generated-catalogue'
import type { ProviderAdapter } from '../providers/adapter'
import { AnthropicAdapter } from '../providers/anthropic-adapter'
import { InferenceAdapter, INFERENCE_PROVIDER_ID } from '../providers/inference-adapter'
import { OpenAiAdapter, OPENAI_PROVIDER_ID } from '../providers/openai-adapter'
import { OpenRouterAdapter, OPENROUTER_PROVIDER_ID } from '../providers/openrouter-adapter'
import type { SettingsService } from '../settings/service'

import type { HarnessLaunch } from './config'
import { faultInjected } from './fault-injection'

/**
 * The child-runner model source: a pinned subagent model when the launch or settings name one, the
 * parent's port otherwise. Built per child, fault-injection wrapping included.
 */
export function childModelSource(args: {
  models: ModelCatalogue
  model: SelectableModel
  modelPort: ModelPort
  hooks: () => HookChain
  settings: SettingsService
}): ReturnType<typeof pinnedModelSource> {
  const { models, model, modelPort } = args

  const pinnedModel = ({ modelId }: { modelId: string }): ReturnType<ProviderAdapter['model']> => {
    const ref = parseRef(modelId)
    const card = ref === undefined ? undefined : models.cardFor(ref)
    const adapter = ref === undefined ? undefined : models.adapterFor(ref.providerId)
    if (card === undefined || adapter === undefined)
      throw new Error(`no provider adapter can answer for ${modelId}`)

    return adapter.model({ card, effort: () => model.choice().effort })
  }

  /** A setting that names a model nothing can run is skipped, not thrown on, so a stale pick degrades to the next voice in the chain instead of failing every spawn. */
  const liveSetting = (id: string): string | undefined => {
    const held = textValueOf({ resolution: args.settings.snapshot().resolution, id })
    if (held.length === 0) return undefined

    const ref = parseRef(held)
    return ref !== undefined && isRefReachable({ catalogue: models, ref }) ? held : undefined
  }

  return pinnedModelSource({
    typeModelId: (typeName) => liveSetting(agentTypeSettingId(typeName)),
    subagentModelId: () => liveSetting(ESettingId.SubagentModel),
    inherited: () => modelPort,
    build: ({ modelId }) =>
      faultInjected(
        new AiSdkModelPort({
          model: pinnedModel({ modelId }),
          hooks: args.hooks(),
        }),
      ),
  })
}

import { createExecutionLocationState, type ExecutionLocationState } from './execution-location-state'
import { executionPinned, resolveExecutionLocation } from './execution-preference'
import { isRefReachable, modelCatalogue, type ModelCatalogue } from './model-catalogue'
import { launchSelection, modelPinned } from './model-preference'
import { selectableModel, type SelectableModel } from './model-selection'
import { bindSandbox, type SandboxControl } from './sandbox-binding'
import type { SandboxStatusState } from './sandbox-status-state'

export type ModelBindings = {
  models: ModelCatalogue
  model: SelectableModel
  modelPinned: boolean
  executionLocation: ExecutionLocationState
  executionPinned: boolean
  sandbox: SandboxControl
  containerStatus: SandboxStatusState
  mounts: readonly string[]
}

const emptyToUndefined = (value: string | undefined): string | undefined =>
  value === undefined || value.length === 0 ? undefined : value

export async function bindModels(args: {
  container: DependencyContainer
  launch: HarnessLaunch
  /** The directory the sandbox binds and roots resolve against — the launch cwd, or the process directory for a workspace-less session. */
  anchor: string
  settled: SettingsResolution
  settings: SettingsService
  credentials: CredentialPort
  accountList: readonly Account[]
  notice: NoticePort
  env: Record<string, string | undefined>
}): Promise<ModelBindings> {
  const { container, launch, settled, settings, credentials, notice } = args

  const models = modelCatalogue({
    adapters: [
      new AnthropicAdapter({ credentials, cards: cardsForProvider(ANTHROPIC_PROVIDER_ID) }),
      new OpenAiAdapter({ credentials, cards: cardsForProvider(OPENAI_PROVIDER_ID) }),
      new OpenRouterAdapter({
        credentials,
        cards: cardsForProvider(OPENROUTER_PROVIDER_ID),
        baseUrl: emptyToUndefined(args.env.OPENROUTER_BASE_URL),
      }),
      new InferenceAdapter({ credentials, cards: cardsForProvider(INFERENCE_PROVIDER_ID) }),
    ],
    accounts: args.accountList,
  })

  const model = selectableModel({
    catalogue: models,
    initial: launchSelection({
      requested: { model: launch.model },
      settled,
      catalogue: models,
    }),
  })

  const executionLocation = createExecutionLocationState({
    initial: resolveExecutionLocation({
      requested: launch.executionLocation,
      stored: undefined,
      settled,
    }),
  })

  const { sandbox, containerStatus, mounts } = await bindSandbox({
    container,
    engine: container.resolve(DockerEngineToken),
    cwd: args.anchor,
    settings,
    executionLocation,
    notice,
  })

  container.register(LanguageModelToken, { useValue: model.model })
  container.register(ModelCardSourceToken, {
    useValue: () => models.cardFor(model.choice().ref),
  })

  return {
    models,
    model,
    modelPinned: modelPinned({ requested: { model: launch.model }, catalogue: models }),
    executionLocation,
    executionPinned: executionPinned({ requested: launch.executionLocation }),
    sandbox,
    containerStatus,
    mounts,
  }
}
