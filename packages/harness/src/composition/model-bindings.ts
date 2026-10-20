import {
  ANTHROPIC_PROVIDER_ID,
  EAuthKind,
  EAuthProvider,
  type Account,
  type CredentialPort,
  ExecutionLocationSinkPort,
  type NoticePort,
  type SettingsResolution,
} from '@dltech/atlas-core'

import { registeredPortToken, type DependencyContainer } from '../container/injection'
import { LanguageModelToken, ModelCardSourceToken, SelectableModelToken } from '../container/tokens'
import { CodexModelsCatalogue } from '../models/codex-models-catalogue'
import { cardsForProvider } from '../models/generated-catalogue'
import { CODEX_VERSION } from '../providers/codex-version'
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

export type ModelBindings = {
  models: ModelCatalogue
  model: SelectableModel
  modelPinned: boolean
  executionLocation: ExecutionLocationState
  executionPinned: boolean
}

const emptyToUndefined = (value: string | undefined): string | undefined =>
  value === undefined || value.length === 0 ? undefined : value

const holdsOpenAiLogin = (accounts: readonly Account[]): boolean =>
  accounts.some(
    (account) => account.provider === EAuthProvider.OpenAI && account.kind === EAuthKind.Oauth,
  )

export async function bindModels(args: {
  container: DependencyContainer
  launch: HarnessLaunch
  settled: SettingsResolution
  settings: SettingsService
  credentials: CredentialPort
  accountList: readonly Account[]
  notice: NoticePort
  env: Record<string, string | undefined>
}): Promise<ModelBindings> {
  const { container, launch, settled, settings, credentials, notice } = args

  const codexModels = new CodexModelsCatalogue({
    credentials,
    provider: EAuthProvider.OpenAI,
    clientVersion: CODEX_VERSION,
  })

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
    live: {
      cards: (providerId) => (providerId === OPENAI_PROVIDER_ID ? codexModels.cards() : undefined),
      subscribe: (listener) => codexModels.subscribe(listener),
      refresh: () => codexModels.refresh(),
    },
  })

  if (holdsOpenAiLogin(args.accountList)) void codexModels.refresh()

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
  container.register(registeredPortToken(ExecutionLocationSinkPort), {
    useValue: {
      refresh: ({ threadId }) => executionLocation.refresh({ threadId }),
    },
  })
  container.register(ExecutionLocationToken, { useValue: { state: executionLocation, pinned } })

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
  }
}
