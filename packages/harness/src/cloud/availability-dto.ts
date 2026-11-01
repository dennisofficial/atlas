import {
  admissionPermitSchema as corePermitSchema,
  availabilityKeySchema as coreKeySchema,
  availabilitySnapshotSchema as coreSnapshotSchema,
  normalizedProviderFailureSchema as coreFailureSchema,
  type AdmissionCompletion,
  type AdmissionDecision,
  type AdmissionPermit,
  type AvailabilityKey,
  type AvailabilitySnapshot,
  type CredentialRevision,
  type EAvailabilityControl,
  type NormalizedProviderFailure,
} from '@dltech/atlas-core'
import {
  admissionCompletionSchema,
  admissionDecisionSchema,
  admissionPermitSchema,
  availabilityKeySchema,
  availabilitySnapshotSchema,
  controlAvailabilityInputSchema,
  credentialRevisionSchema,
  normalizedProviderFailureSchema,
  type AdmissionCompletion as WireCompletion,
  type AdmissionPermit as WirePermit,
  type ControlAvailabilityInput,
  type InspectAvailabilityInput,
  type PromoteProbeInput,
} from '@dltech/atlas-wire'

const MAX_FAILURE_MESSAGE_LENGTH = 16_384

export class MissingPermitIdError extends Error {
  constructor() {
    super('a remote availability settlement needs the permitId the server issued at admit')
    this.name = 'MissingPermitIdError'
  }
}

export const wireKeyOf = (key: AvailabilityKey) => availabilityKeySchema.parse(key)

export const wireRevisionOf = (revision: CredentialRevision) =>
  credentialRevisionSchema.parse(revision)

export const wireKeyedInputOf = (args: {
  key: AvailabilityKey
  revision: CredentialRevision
}): InspectAvailabilityInput => ({
  key: wireKeyOf(args.key),
  revision: wireRevisionOf(args.revision),
})

export const wireControlInputOf = (args: {
  key: AvailabilityKey
  revision: CredentialRevision
  action: EAvailabilityControl
}): ControlAvailabilityInput =>
  controlAvailabilityInputSchema.parse({
    ...wireKeyedInputOf(args),
    action: args.action,
  })

export const wirePermitOf = (permit: AdmissionPermit): WirePermit => {
  if (permit.permitId === undefined) throw new MissingPermitIdError()
  return admissionPermitSchema.parse(corePermitSchema.parse(permit))
}

const wireFailureOf = (failure: NormalizedProviderFailure) => {
  const parsed = coreFailureSchema.parse(failure)
  return normalizedProviderFailureSchema.parse({
    ...parsed,
    message: parsed.message.slice(0, MAX_FAILURE_MESSAGE_LENGTH),
  })
}

export const wirePromoteProbeInputOf = (args: {
  permit: AdmissionPermit
  failure: NormalizedProviderFailure
}): PromoteProbeInput => ({
  permit: wirePermitOf(args.permit),
  failure: wireFailureOf(args.failure),
})

export const wireCompletionOf = (completion: AdmissionCompletion): WireCompletion =>
  admissionCompletionSchema.parse(
    'failure' in completion
      ? { ...completion, failure: wireFailureOf(completion.failure) }
      : completion,
  )

export const snapshotOfWire = (body: unknown): AvailabilitySnapshot =>
  coreSnapshotSchema.parse(availabilitySnapshotSchema.parse(body))

export const decisionOfWire = (body: unknown): AdmissionDecision => {
  const decision = admissionDecisionSchema.parse(body)
  if (decision.admitted) {
    return { admitted: true, permit: corePermitSchema.parse(decision.permit) }
  }
  return {
    admitted: false,
    block: {
      key: coreKeySchema.parse(decision.block.key),
      snapshot: snapshotOfWire(decision.block.snapshot),
    },
  }
}
