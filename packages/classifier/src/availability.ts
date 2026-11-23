import { parseRef, type EAuthProvider } from '@dltech/atlas-core'

import { DECISION_MODELS, decisionModelOf, type DecisionModel } from './models'

export type ClassifierCredential =
  | { kind: 'api-key'; accountId: string; apiKey?: string | undefined }
  | { kind: 'plan'; accountId: string }

export enum EClassifierOffReason {
  NoModel = 'no classifier model is set',
  UnknownModel = 'the chosen model is not a decision model',
  NotConnected = 'the provider is not connected',
  PlanHasNoKey = 'the provider is connected by a plan, which has no API key',
}

export type ClassifierAvailability =
  | { on: true; model: DecisionModel; credential: ClassifierCredential & { kind: 'api-key' } }
  | { on: false; reason: EClassifierOffReason; provider?: EAuthProvider | undefined }

export function classifierAvailabilityOf(args: {
  stored: string | undefined
  credentialOf: (provider: EAuthProvider) => ClassifierCredential | null
}): ClassifierAvailability {
  const stored = args.stored ?? ''
  if (stored.length === 0 || parseRef(stored) === undefined) {
    return { on: false, reason: EClassifierOffReason.NoModel }
  }

  const model = decisionModelOf(stored)
  if (model === undefined) return { on: false, reason: EClassifierOffReason.UnknownModel }

  const credential = args.credentialOf(model.provider)
  if (credential === null) {
    return { on: false, reason: EClassifierOffReason.NotConnected, provider: model.provider }
  }
  if (credential.kind === 'plan') {
    return { on: false, reason: EClassifierOffReason.PlanHasNoKey, provider: model.provider }
  }
  return { on: true, model, credential }
}

export function suggestedModelOf(args: {
  credentialOf: (provider: EAuthProvider) => ClassifierCredential | null
}): DecisionModel | undefined {
  return DECISION_MODELS.find((model) => args.credentialOf(model.provider)?.kind === 'api-key')
}
