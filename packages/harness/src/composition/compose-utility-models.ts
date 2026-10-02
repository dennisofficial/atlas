import type { LanguageModelV4 } from '@ai-sdk/provider'

import {
  DecisionPort,
  EUtilityModelRole,
  JudgePort,
  type NoticePort,
  type SecretsPort,
} from '@dltech/atlas-core'

import { portToken, type DependencyContainer } from '../container/injection'
import { HaikuJudge } from '../classifier/judge'
import { JevDecisionClient } from '../classifier/jev-client'
import { JevJudge } from '../classifier/jev-judge'
import { decisionsConfigFrom, RoutedJudge } from '../classifier/routed-judge'
import { summaryFor } from '../model/summariser'
import { titleFor } from '../model/titler'
import type { SettingsService } from '../settings/service'

import type { Summariser } from './compact-turn'
import type { SessionTitler } from './harness-app'
import type { ModelCatalogue } from './model-catalogue'
import type { ModelChoice } from './model-selection'
import { createUtilityModel } from './utility-model'

export type UtilityModels = {
  decisionsEnabled: () => boolean
  tldrModel: LanguageModelV4
  titler: SessionTitler
  summarise: Summariser
}

export function bindUtilityModels(args: {
  container: DependencyContainer
  settings: SettingsService
  secrets: SecretsPort
  models: ModelCatalogue
  model: ModelChoice
  notice: NoticePort
}): UtilityModels {
  const { container, settings, models, model, notice } = args

  const decisionsConfig = decisionsConfigFrom({ settings, secrets: args.secrets })
  const decisions = new JevDecisionClient({ config: decisionsConfig })
  container.register(portToken(DecisionPort), { useValue: decisions })

  const fallback = (): LanguageModelV4 | undefined => {
    const choice = model.choice()
    const card = models.cardFor(choice.ref)
    const adapter = models.adapterFor(choice.ref.providerId)
    if (card === undefined || adapter === undefined) return undefined
    return adapter.model({ card, effort: () => model.choice().effort })
  }

  const utility = (role: EUtilityModelRole): LanguageModelV4 =>
    createUtilityModel({ role, settings, catalogue: models, notice, fallback })

  container.register(portToken(JudgePort), {
    useValue: new RoutedJudge({
      fallback: new HaikuJudge({ model: utility(EUtilityModelRole.Judge) }),
      jev: new JevJudge({ decisions }),
      enabled: () => decisionsConfig() !== undefined,
    }),
  })

  const titlerModel = utility(EUtilityModelRole.Titler)
  const compactionModel = utility(EUtilityModelRole.Compaction)

  return {
    decisionsEnabled: () => decisionsConfig() !== undefined,
    tldrModel: utility(EUtilityModelRole.Tldr),
    titler: ({ text, images, signal }) =>
      titleFor({ model: titlerModel, fallback, text, images, signal }),
    summarise: ({ events, fromSeq, throughSeq, signal }) =>
      summaryFor({
        model: compactionModel,
        events,
        fromSeq,
        throughSeq,
        ...(signal === undefined ? {} : { signal }),
      }),
  }
}
