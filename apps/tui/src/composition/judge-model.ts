import {
  EEffort,
  EUtilityModelRole,
  findCard,
  refKey,
  resolveUtilityModel,
  type CredentialPort,
  type ModelRef,
} from '@dltech/atlas-core'
import {
  DEFAULT_MODEL_REF,
  generatedCatalogue,
  providerAdapters,
  unanswerableRef,
  type ProviderAdapter,
} from '@dltech/atlas-harness'

export const judgeRefFor = ({
  override,
  followDefault = DEFAULT_MODEL_REF,
}: {
  override: string
  followDefault?: ModelRef
}): ModelRef =>
  resolveUtilityModel({
    role: EUtilityModelRole.Judge,
    override,
    followDefault,
    catalogue: generatedCatalogue(),
  })

export function judgeModel({
  ref,
  credentials,
}: {
  ref: ModelRef
  credentials: CredentialPort
}): ReturnType<ProviderAdapter['model']> {
  const adapter = providerAdapters({ credentials }).find((one) => one.id === ref.providerId)
  const card = findCard({ catalog: generatedCatalogue(), ref })
  if (adapter === undefined || card === undefined) throw unanswerableRef(refKey(ref))

  return adapter.model({ card, effort: () => EEffort.Low })
}
