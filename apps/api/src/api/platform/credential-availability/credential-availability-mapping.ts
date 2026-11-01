import {
  admissionCompletionSchema as coreCompletionSchema,
  admissionPermitSchema as corePermitSchema,
  availabilityKeySchema as coreKeySchema,
  availabilitySnapshotSchema as coreSnapshotSchema,
  credentialRevisionSchema as coreRevisionSchema,
  normalizedProviderFailureSchema as coreFailureSchema,
  PROBE_LEASE_MS,
  type AdmissionCompletion,
  type AdmissionPermit,
  type AvailabilityKey,
  type AvailabilitySnapshot,
  type AvailabilityState,
  type CredentialRevision,
  type NormalizedProviderFailure,
} from '@dltech/atlas-core'
import type { Row } from '@dltech/atlas-db'
import {
  admissionDecisionSchema,
  availabilitySnapshotSchema,
  type AdmissionCompletion as WireCompletion,
  type AdmissionDecision,
  type AdmissionPermit as WirePermit,
  type AvailabilityKey as WireKey,
  type AvailabilitySnapshot as WireSnapshot,
  type CredentialRevision as WireRevision,
  type PromoteProbeInput,
} from '@dltech/atlas-wire'

export type BarrierRef = { key: AvailabilityKey; revision: CredentialRevision }

export const refOf = (input: { key: WireKey; revision: WireRevision }): BarrierRef => ({
  key: coreKeySchema.parse(input.key),
  revision: coreRevisionSchema.parse(input.revision),
})

export const permitOf = (permit: WirePermit): AdmissionPermit => corePermitSchema.parse(permit)

export const completionOf = (completion: WireCompletion): AdmissionCompletion =>
  coreCompletionSchema.parse(completion)

export const failureOf = (failure: PromoteProbeInput['failure']): NormalizedProviderFailure =>
  coreFailureSchema.parse(failure)

export const wireSnapshotOf = (snapshot: AvailabilitySnapshot): WireSnapshot =>
  availabilitySnapshotSchema.parse(snapshot)

export const wireAdmittedOf = (args: {
  permit: AdmissionPermit
  permitId: string
}): AdmissionDecision =>
  admissionDecisionSchema.parse({
    admitted: true,
    permit: { ...args.permit, permitId: args.permitId },
  })

export const wireBlockedOf = (snapshot: AvailabilitySnapshot): AdmissionDecision =>
  admissionDecisionSchema.parse({
    admitted: false,
    block: { key: snapshot.key, snapshot },
  })

const admittedAtOf = (probeExpiresAt: Date): string =>
  new Date(probeExpiresAt.getTime() - PROBE_LEASE_MS).toISOString()

export function stateOfRow(
  row: Row<'CredentialAvailability'> | null,
): AvailabilityState | undefined {
  if (row === null) return undefined
  const snapshot = coreSnapshotSchema.parse({
    key: {
      accountId: row.accountId,
      providerId: row.providerId,
      modelId: row.modelId,
    },
    availability: row.availability,
    revision: { fence: row.fence, value: row.revision },
    since: row.since.toISOString(),
    ...(row.until === null ? {} : { until: row.until.toISOString() }),
    ...(row.reason === null ? {} : { reason: row.reason }),
  })
  if (row.probeId === null || row.probeExpiresAt === null) return { snapshot }
  return {
    snapshot,
    probe: {
      permit: {
        key: snapshot.key,
        revision: snapshot.revision,
        probe: true,
        admittedAt: admittedAtOf(row.probeExpiresAt),
      },
      leasedUntilMs: row.probeExpiresAt.getTime(),
    },
  }
}
