import { z } from 'zod'

import {
  normalizedProviderFailureSchema,
  type NormalizedProviderFailure,
} from '../models/provider-failure'
import {
  accountIdSchema,
  authorityOf,
  EAuthKind,
  type AccountId,
  type StoredAccount,
} from './account'

export enum ECredentialFence {
  Replaced = 'replaced',
  Refreshed = 'refreshed',
}

export type CredentialRevision = { fence: ECredentialFence; value: number }

export type AvailabilityKey = {
  accountId: AccountId
  providerId: string
  modelId: string
}

export enum ECredentialAvailability {
  Available = 'available',
  Cooldown = 'cooldown',
  QuotaExhausted = 'quota-exhausted',
  AuthRejected = 'auth-rejected',
  ModelDenied = 'model-denied',
  DeliveryFault = 'delivery-fault',
  Paused = 'paused',
}

export type AvailabilitySnapshot = {
  key: AvailabilityKey
  availability: ECredentialAvailability
  revision: CredentialRevision
  since: string
  until?: string | undefined
  reason?: string | undefined
}

export type AdmissionPermit = {
  key: AvailabilityKey
  revision: CredentialRevision
  probe: boolean
  admittedAt: string
  permitId?: string | undefined
}

export enum EAdmissionCompletion {
  Succeeded = 'succeeded',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export type AdmissionCompletion =
  | { outcome: EAdmissionCompletion.Succeeded }
  | { outcome: EAdmissionCompletion.Failed; failure: NormalizedProviderFailure }
  | { outcome: EAdmissionCompletion.Cancelled }

export type AdmissionBlock = {
  key: AvailabilityKey
  snapshot: AvailabilitySnapshot
}

export type AdmissionDecision =
  | { admitted: true; permit: AdmissionPermit }
  | { admitted: false; block: AdmissionBlock }

export enum EAvailabilityControl {
  Pause = 'pause',
  Resume = 'resume',
}

export const availabilityKeySchema: z.ZodType<AvailabilityKey> = z.object({
  accountId: accountIdSchema,
  providerId: z.string().min(1),
  modelId: z.string().min(1),
})

export const credentialRevisionSchema: z.ZodType<CredentialRevision> = z.object({
  fence: z.enum(ECredentialFence),
  value: z.number().int().nonnegative(),
})

export const availabilitySnapshotSchema: z.ZodType<AvailabilitySnapshot> = z.object({
  key: availabilityKeySchema,
  availability: z.enum(ECredentialAvailability),
  revision: credentialRevisionSchema,
  since: z.string(),
  until: z.string().optional(),
  reason: z.string().optional(),
})

export const admissionPermitSchema: z.ZodType<AdmissionPermit> = z.object({
  key: availabilityKeySchema,
  revision: credentialRevisionSchema,
  probe: z.boolean(),
  admittedAt: z.string(),
  permitId: z.string().optional(),
})

export const admissionCompletionSchema: z.ZodType<AdmissionCompletion> = z.discriminatedUnion(
  'outcome',
  [
    z.object({ outcome: z.literal(EAdmissionCompletion.Succeeded) }),
    z.object({
      outcome: z.literal(EAdmissionCompletion.Failed),
      failure: normalizedProviderFailureSchema,
    }),
    z.object({ outcome: z.literal(EAdmissionCompletion.Cancelled) }),
  ],
)

const fenceOf = (stored: StoredAccount): ECredentialFence => {
  if (stored.secret.kind === EAuthKind.ApiKey) return ECredentialFence.Replaced
  return authorityOf(stored.secret) === undefined
    ? ECredentialFence.Replaced
    : ECredentialFence.Refreshed
}

export const revisionOf = (stored: StoredAccount): CredentialRevision => ({
  fence: fenceOf(stored),
  value: stored.authorizationRevision ?? 0,
})
