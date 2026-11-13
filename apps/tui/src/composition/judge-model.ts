import {
  EUtilityModelRole,
  findCard,
  refKey,
  type CredentialPort,
  type ModelChoice,
  type SettingsResolution,
} from '@dltech/atlas-core'
import {
  modelCatalogue,
  providerAdapters,
  unanswerableRef,
  utilityChoiceOf,
  type ModelCatalogue,
} from '@dltech/atlas-harness'
import { generatedCatalogue } from '@dltech/atlas-models'

const refusingCredentials: CredentialPort = {
  read: () => Promise.reject(new Error('the classify bench reads credentials when it calls')),
  discard: () => Promise.resolve(),
}

/**
 * The bench reads settings before it holds any account, so it cannot tell a reachable provider from
 * a lapsed one: every provider its adapters carry stands as reachable and a dead credential surfaces
 * as the judge fault it is.
 */
const benchCatalogue = (): ModelCatalogue => ({
  ...modelCatalogue({ adapters: providerAdapters({ credentials: refusingCredentials }) }),
  reachable: () => true,
})

export const judgeChoiceFor = ({ settled }: { settled: SettingsResolution }): ModelChoice =>
  utilityChoiceOf({ role: EUtilityModelRole.Judge, settled, catalogue: benchCatalogue() })

export function judgeModel({
  choice,
  credentials,
}: {
  choice: ModelChoice
  credentials: CredentialPort
}): ReturnType<ReturnType<typeof providerAdapters>[number]['model']> {
  const adapter = providerAdapters({ credentials }).find((one) => one.id === choice.ref.providerId)
  const card = findCard({ catalog: generatedCatalogue(), ref: choice.ref })
  if (adapter === undefined || card === undefined) throw unanswerableRef(refKey(choice.ref))

  return adapter.model({ card, effort: () => choice.effort, fast: () => choice.fast })
}
