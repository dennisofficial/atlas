import type { AccountId, CredentialPort, EEffort, ModelCard } from '@dltech/atlas-core'

export type ProviderModelArgs = {
  modelId: string
  card: ModelCard | undefined
  credentials: CredentialPort
  accountId?: AccountId | undefined
  effort: () => EEffort
  fast?: (() => boolean) | undefined
  fetch?: typeof fetch | undefined
}
