import { z } from 'zod'

export enum ECredentialFence {
  Replaced = 'replaced',
  Refreshed = 'refreshed',
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

export enum EAdmissionCompletion {
  Succeeded = 'succeeded',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export enum EAvailabilityControl {
  Pause = 'pause',
  Resume = 'resume',
}

export enum EProviderFailureKind {
  Auth = 'auth',
  Quota = 'quota',
  RateLimited = 'rate-limited',
  Network = 'network',
  Overloaded = 'overloaded',
  Stalled = 'stalled',
  Delivery = 'delivery',
  ModelDenied = 'model-denied',
  ContextOverflow = 'context-overflow',
  InvalidRequest = 'invalid-request',
  Cancelled = 'cancelled',
  Other = 'other',
}

export enum EProviderFailureScope {
  Credential = 'credential',
  Route = 'route',
  Request = 'request',
}

export enum EProviderRetry {
  Transient = 'transient',
  Never = 'never',
}

const MAX_ACCOUNT_ID_LENGTH = 256
const MAX_PROVIDER_ID_LENGTH = 256
const MAX_MODEL_ID_LENGTH = 512
const MAX_PERMIT_ID_LENGTH = 64
const MAX_INSTANT_LENGTH = 64
const MAX_FAILURE_MESSAGE_LENGTH = 16_384

const instantSchema = z.string().min(1).max(MAX_INSTANT_LENGTH)

export const availabilityKeySchema = z.strictObject({
  accountId: z.string().min(1).max(MAX_ACCOUNT_ID_LENGTH),
  providerId: z.string().min(1).max(MAX_PROVIDER_ID_LENGTH),
  modelId: z.string().min(1).max(MAX_MODEL_ID_LENGTH),
})

export const credentialRevisionSchema = z.strictObject({
  fence: z.enum(ECredentialFence),
  value: z.number().int().nonnegative(),
})

export const availabilitySnapshotSchema = z.strictObject({
  key: availabilityKeySchema,
  availability: z.enum(ECredentialAvailability),
  revision: credentialRevisionSchema,
  since: instantSchema,
  until: instantSchema.optional(),
  reason: z.string().optional(),
})

export const admissionPermitSchema = z.strictObject({
  key: availabilityKeySchema,
  revision: credentialRevisionSchema,
  probe: z.boolean(),
  admittedAt: instantSchema,
  permitId: z.string().min(1).max(MAX_PERMIT_ID_LENGTH),
})

export const normalizedProviderFailureSchema = z.strictObject({
  kind: z.enum(EProviderFailureKind),
  scope: z.enum(EProviderFailureScope),
  retry: z.enum(EProviderRetry),
  message: z.string().max(MAX_FAILURE_MESSAGE_LENGTH),
  statusCode: z.number().int().optional(),
  providerCode: z.string().optional(),
  providerType: z.string().optional(),
  providerId: z.string().min(1).max(MAX_PROVIDER_ID_LENGTH).optional(),
  modelId: z.string().min(1).max(MAX_MODEL_ID_LENGTH).optional(),
  accountId: z.string().min(1).max(MAX_ACCOUNT_ID_LENGTH).optional(),
  retryAt: instantSchema.optional(),
  resetAt: instantSchema.optional(),
})

export const admissionCompletionSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal(EAdmissionCompletion.Succeeded) }),
  z.strictObject({
    outcome: z.literal(EAdmissionCompletion.Failed),
    failure: normalizedProviderFailureSchema,
  }),
  z.strictObject({ outcome: z.literal(EAdmissionCompletion.Cancelled) }),
])

export const admissionDecisionSchema = z.discriminatedUnion('admitted', [
  z.strictObject({ admitted: z.literal(true), permit: admissionPermitSchema }),
  z.strictObject({
    admitted: z.literal(false),
    block: z.strictObject({
      key: availabilityKeySchema,
      snapshot: availabilitySnapshotSchema,
    }),
  }),
])

export const inspectAvailabilityInputSchema = z.strictObject({
  key: availabilityKeySchema,
  revision: credentialRevisionSchema,
})

export const admitAvailabilityInputSchema = inspectAvailabilityInputSchema

export const completeAvailabilityInputSchema = z.strictObject({
  permit: admissionPermitSchema,
  completion: admissionCompletionSchema,
})

export const promoteProbeInputSchema = z.strictObject({
  permit: admissionPermitSchema,
  failure: normalizedProviderFailureSchema,
})

export const controlAvailabilityInputSchema = z.strictObject({
  key: availabilityKeySchema,
  revision: credentialRevisionSchema,
  action: z.enum(EAvailabilityControl),
})

export type AvailabilityKey = z.infer<typeof availabilityKeySchema>
export type CredentialRevision = z.infer<typeof credentialRevisionSchema>
export type AvailabilitySnapshot = z.infer<typeof availabilitySnapshotSchema>
export type AdmissionPermit = z.infer<typeof admissionPermitSchema>
export type AdmissionCompletion = z.infer<typeof admissionCompletionSchema>
export type AdmissionDecision = z.infer<typeof admissionDecisionSchema>
export type InspectAvailabilityInput = z.infer<typeof inspectAvailabilityInputSchema>
export type AdmitAvailabilityInput = z.infer<typeof admitAvailabilityInputSchema>
export type CompleteAvailabilityInput = z.infer<typeof completeAvailabilityInputSchema>
export type PromoteProbeInput = z.infer<typeof promoteProbeInputSchema>
export type ControlAvailabilityInput = z.infer<typeof controlAvailabilityInputSchema>
