import type {
  AdmissionCompletion,
  AdmissionDecision,
  AdmissionPermit,
  AvailabilityKey,
  AvailabilitySnapshot,
  CredentialRevision,
  EAvailabilityControl,
} from '../credentials/credential-availability'
import type { NormalizedProviderFailure } from '../models/provider-failure'

export abstract class CredentialAvailabilityPort {
  abstract inspect(args: {
    key: AvailabilityKey
    revision: CredentialRevision
  }): Promise<AvailabilitySnapshot>

  abstract admit(args: {
    key: AvailabilityKey
    revision: CredentialRevision
  }): Promise<AdmissionDecision>

  abstract promoteProbe(args: {
    permit: AdmissionPermit
    failure: NormalizedProviderFailure
  }): Promise<void>

  abstract complete(args: {
    permit: AdmissionPermit
    completion: AdmissionCompletion
  }): Promise<void>

  abstract control(args: {
    key: AvailabilityKey
    revision: CredentialRevision
    action: EAvailabilityControl
  }): Promise<AvailabilitySnapshot>
}
