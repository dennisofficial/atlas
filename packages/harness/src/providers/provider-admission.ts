import type { LanguageModelV4 } from '@ai-sdk/provider'

import {
  ECredentialFence,
  type ClockPort,
  type Credential,
  type CredentialAvailabilityPort,
  type CredentialRevision,
} from '@dltech/atlas-core'

import { admittedModel } from '../model/admitted-model'

export type ProviderAdmission = {
  availability: CredentialAvailabilityPort
  clock: ClockPort
}

const UNKNOWN_ACCOUNT_REVISION: CredentialRevision = {
  fence: ECredentialFence.Replaced,
  value: 0,
}

export function admittedByAccount(args: {
  admission: ProviderAdmission | undefined
  model: LanguageModelV4
  credential: Credential
  providerId: string
  modelId: string
}): LanguageModelV4 {
  const { admission, credential } = args
  if (admission === undefined) return args.model

  return admittedModel({
    model: args.model,
    key: {
      accountId: credential.accountId,
      providerId: args.providerId,
      modelId: args.modelId,
    },
    revision: async () => credential.revision ?? UNKNOWN_ACCOUNT_REVISION,
    availability: admission.availability,
    clock: admission.clock,
  })
}
