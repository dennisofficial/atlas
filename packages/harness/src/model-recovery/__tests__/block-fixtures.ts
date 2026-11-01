import {
  ECredentialAvailability,
  ECredentialFence,
  toAccountId,
  type AvailabilityKey,
  type ModelPort,
  type ModelStepResult,
  type ProviderIdentity,
} from '@dltech/atlas-core'

import { ModelAdmissionBlockedError } from '../../model/admission-blocked'

export const blockedKey = (accountId = 'acct_1'): AvailabilityKey => ({
  accountId: toAccountId(accountId),
  providerId: 'anthropic',
  modelId: 'claude-opus-5',
})

export const blockedError = (
  args: {
    accountId?: string
    availability?: ECredentialAvailability
    until?: string
    revision?: number
  } = {},
): ModelAdmissionBlockedError => {
  const key = blockedKey(args.accountId)
  return new ModelAdmissionBlockedError({
    block: {
      key,
      snapshot: {
        key,
        availability: args.availability ?? ECredentialAvailability.QuotaExhausted,
        revision: {
          fence: ECredentialFence.Replaced,
          value: args.revision ?? 1,
        },
        since: '2026-11-01T12:00:00.000Z',
        ...(args.until === undefined ? {} : { until: args.until }),
      },
    },
  })
}

export class DeniedModel implements ModelPort {
  readonly identity: ProviderIdentity = {
    id: 'anthropic',
    modelId: 'claude-opus-5',
  }
  calls = 0
  constructor(private readonly denial: () => Error) {}
  async step(): Promise<ModelStepResult> {
    this.calls += 1
    throw this.denial()
  }
}
