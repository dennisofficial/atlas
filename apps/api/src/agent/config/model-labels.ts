import {
  findCard,
  providerLabelOf,
  refKey,
  unavailableModelMessage,
  type ModelRef,
} from '@dltech/atlas-core'
import { generatedCatalogue } from '@dltech/atlas-models'

export const modelLabelOf = (ref: ModelRef): string =>
  findCard({ catalog: generatedCatalogue(), ref })?.label ?? refKey(ref)

export const providerLabelOfRef = (ref: ModelRef): string =>
  providerLabelOf(ref.providerId) ?? ref.providerId

export const mainAgentUnavailableMessage = (ref: ModelRef): string =>
  unavailableModelMessage({
    subject: 'Your main agent',
    modelLabel: modelLabelOf(ref),
    providerLabel: providerLabelOfRef(ref),
  })
