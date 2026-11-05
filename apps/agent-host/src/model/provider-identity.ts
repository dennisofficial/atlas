import type { LanguageModel } from 'ai'

import type { ProviderIdentity } from '@dltech/atlas-core'

import { GATEWAY_PROVIDER_ID } from './provider-ids'

export function providerIdentityOf(model: LanguageModel): ProviderIdentity {
  if (typeof model === 'string') return { id: GATEWAY_PROVIDER_ID, modelId: model }

  return { id: model.provider, modelId: model.modelId }
}
