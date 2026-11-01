import {
  CredentialAvailabilityPort,
  type AdmissionCompletion,
  type AdmissionDecision,
  type AdmissionPermit,
  type AvailabilityKey,
  type AvailabilitySnapshot,
  type CredentialRevision,
  type EAvailabilityControl,
  type NormalizedProviderFailure,
} from '@dltech/atlas-core'

import type { CloudClient } from './cloud-client'

export class RemoteCredentialAvailability extends CredentialAvailabilityPort {
  private readonly client: CloudClient

  constructor(args: { client: CloudClient }) {
    super()
    this.client = args.client
  }

  inspect(args: {
    key: AvailabilityKey
    revision: CredentialRevision
  }): Promise<AvailabilitySnapshot> {
    return this.client.inspectAvailability(args)
  }

  admit(args: { key: AvailabilityKey; revision: CredentialRevision }): Promise<AdmissionDecision> {
    return this.client.admitAvailability(args)
  }

  promoteProbe(args: {
    permit: AdmissionPermit
    failure: NormalizedProviderFailure
  }): Promise<void> {
    return this.client.promoteProbeAvailability(args)
  }

  complete(args: { permit: AdmissionPermit; completion: AdmissionCompletion }): Promise<void> {
    return this.client.completeAvailability(args)
  }

  control(args: {
    key: AvailabilityKey
    revision: CredentialRevision
    action: EAvailabilityControl
  }): Promise<AvailabilitySnapshot> {
    return this.client.controlAvailability(args)
  }
}
