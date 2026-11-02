import {
  ECredentialAvailability,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  runFailureKindOfProviderKind,
  type AdmissionBlock,
  type NormalizedProviderFailure,
} from '@dltech/atlas-core'

import { safeFailureMessage } from './safe-failure-message'
import { TurnFault } from './turn-fault'

type Verdict = { kind: EProviderFailureKind; scope: EProviderFailureScope }

const verdictOf = (availability: ECredentialAvailability): Verdict => {
  switch (availability) {
    case ECredentialAvailability.AuthRejected:
    case ECredentialAvailability.Paused:
      return { kind: EProviderFailureKind.Auth, scope: EProviderFailureScope.Credential }
    case ECredentialAvailability.QuotaExhausted:
    case ECredentialAvailability.Cooldown:
      return { kind: EProviderFailureKind.Quota, scope: EProviderFailureScope.Credential }
    case ECredentialAvailability.DeliveryFault:
      return { kind: EProviderFailureKind.Delivery, scope: EProviderFailureScope.Request }
    case ECredentialAvailability.ModelDenied:
      return { kind: EProviderFailureKind.ModelDenied, scope: EProviderFailureScope.Route }
    case ECredentialAvailability.Available:
      return { kind: EProviderFailureKind.Other, scope: EProviderFailureScope.Request }
  }
}

export class ModelAdmissionBlockedError extends TurnFault {
  readonly block: AdmissionBlock

  constructor(args: { block: AdmissionBlock }) {
    const { key, snapshot } = args.block
    super({
      kind: runFailureKindOfProviderKind(verdictOf(snapshot.availability).kind),
      message: `${key.modelId} on ${key.providerId} is not available right now (${snapshot.availability})`,
      detail: args.block,
    })
    this.name = 'ModelAdmissionBlockedError'
    this.block = args.block
  }
}

export const blockedErrorOf = (chain: readonly unknown[]): ModelAdmissionBlockedError | undefined =>
  chain.find((link) => link instanceof ModelAdmissionBlockedError)

export function blockedFailureOf(chain: readonly unknown[]): NormalizedProviderFailure | undefined {
  const blocked = blockedErrorOf(chain)
  if (blocked === undefined) return undefined

  const { key, snapshot } = blocked.block
  return {
    ...verdictOf(snapshot.availability),
    retry: EProviderRetry.Never,
    message: safeFailureMessage(blocked.message),
    providerId: key.providerId,
    modelId: key.modelId,
    accountId: key.accountId,
    ...(snapshot.until === undefined ? {} : { resetAt: snapshot.until }),
  }
}
