import type { ApiClient } from '@dltech/atlas-api-router'
import type {
  AdmissionCompletion,
  AdmissionDecision,
  AdmissionPermit,
  AvailabilityKey,
  AvailabilitySnapshot,
  CredentialRevision,
  EAvailabilityControl,
  NormalizedProviderFailure,
} from '@dltech/atlas-core'

import {
  decisionOfWire,
  snapshotOfWire,
  wireCompletionOf,
  wireControlInputOf,
  wireKeyedInputOf,
  wirePermitOf,
  wirePromoteProbeInputOf,
} from './availability-dto'
import { cloudCall } from './api-trpc-client'

export type AvailabilityKeyedArgs = {
  key: AvailabilityKey
  revision: CredentialRevision
}
export type AvailabilitySettleArgs = {
  permit: AdmissionPermit
  completion: AdmissionCompletion
}
export type AvailabilityPromoteArgs = {
  permit: AdmissionPermit
  failure: NormalizedProviderFailure
}
export type AvailabilityControlArgs = AvailabilityKeyedArgs & {
  action: EAvailabilityControl
}

export const inspectAvailabilityVia = async (
  args: { api: ApiClient } & AvailabilityKeyedArgs,
): Promise<AvailabilitySnapshot> =>
  snapshotOfWire(
    await cloudCall(args.api.credentialAvailability.inspect.query(wireKeyedInputOf(args))),
  )

export const admitAvailabilityVia = async (
  args: { api: ApiClient } & AvailabilityKeyedArgs,
): Promise<AdmissionDecision> =>
  decisionOfWire(
    await cloudCall(args.api.credentialAvailability.admit.mutate(wireKeyedInputOf(args))),
  )

export const completeAvailabilityVia = async (
  args: { api: ApiClient } & AvailabilitySettleArgs,
): Promise<void> => {
  await cloudCall(
    args.api.credentialAvailability.complete.mutate({
      permit: wirePermitOf(args.permit),
      completion: wireCompletionOf(args.completion),
    }),
  )
}

export const promoteProbeAvailabilityVia = async (
  args: { api: ApiClient } & AvailabilityPromoteArgs,
): Promise<void> => {
  await cloudCall(
    args.api.credentialAvailability.promoteProbe.mutate(wirePromoteProbeInputOf(args)),
  )
}

export const controlAvailabilityVia = async (
  args: { api: ApiClient } & AvailabilityControlArgs,
): Promise<AvailabilitySnapshot> =>
  snapshotOfWire(
    await cloudCall(args.api.credentialAvailability.control.mutate(wireControlInputOf(args))),
  )
