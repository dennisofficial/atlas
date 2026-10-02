import {
  ANTHROPIC_PROVIDER_ID,
  type Account,
  type CredentialPort,
  type NoticePort,
  type SettingsResolution,
} from '@dltech/atlas-core'

import type { DependencyContainer } from '../container/injection'
import { DockerEngineToken, LanguageModelToken, ModelCardSourceToken, SelectableModelToken } from '../container/tokens'
import { cardsForProvider } from '../models/generated-catalogue'
import { AnthropicAdapter } from '../providers/anthropic-adapter'
import { InferenceAdapter, INFERENCE_PROVIDER_ID } from '../providers/inference-adapter'
import { OpenAiAdapter, OPENAI_PROVIDER_ID } from '../providers/openai-adapter'
import { OpenRouterAdapter, OPENROUTER_PROVIDER_ID } from '../providers/openrouter-adapter'
import type { SettingsService } from '../settings/service'

import type { HarnessLaunch } from './config'

import {
  createExecutionLocationState,
  ExecutionLocationToken,
  type ExecutionLocationState,
} from './execution-location-state'
import { executionPinned, resolveExecutionLocation } from './execution-preference'
import { modelCatalogue, type ModelCatalogue } from './model-catalogue'
import { launchSelection, modelPinned } from './model-preference'
import { selectableModel, type SelectableModel } from './model-selection'
import { bindSandbox, type SandboxControl } from './sandbox-binding'
import type { AnchoringControl } from './sandbox-reanchor'
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
  /** The identity the sandbox container is keyed to — the active thread once one is open. */
  sessionKey: () => string
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
  const pinned = executionPinned({ requested: launch.executionLocation })
  const { sandbox, containerStatus, mounts } = await bindSandbox({
    container,
    engine: container.resolve(DockerEngineToken),
    cwd: args.anchor,
    sessionKey: args.sessionKey,
    settings,
    executionLocation,
    notice,
  })
  const control: AnchoringControl = {
    state: executionLocation,
    pinned,
    anchoring: { launchDirectory: args.anchor, prepare: sandbox.prepareWorkspace },
  }
  container.register(ExecutionLocationToken, { useValue: control })

  container.register(LanguageModelToken, { useValue: model.model })
  container.register(SelectableModelToken, { useValue: model })
  container.register(ModelCardSourceToken, {
    useValue: () => models.cardFor(model.choice().ref),
  })

  return {
    models,
    model,
    modelPinned: modelPinned({ requested: { model: launch.model }, catalogue: models }),
    executionLocation,
    executionPinned: pinned,
    sandbox,
    containerStatus,
    mounts,
  }
}
