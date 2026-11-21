import type { AccountId, CredentialPort, EEffort, ModelCard } from '@dltech/atlas-core'

import type { FastRefusal } from './fast-fallback'

export type ProviderModelArgs = {
  modelId: string
  card: ModelCard | undefined
  credentials: CredentialPort
  accountId?: AccountId | undefined
  effort: () => EEffort
  fast?: (() => boolean) | undefined
  onFastRefused?: ((refusal: FastRefusal) => Promise<void> | void) | undefined
  fetch?: typeof fetch | undefined
}
