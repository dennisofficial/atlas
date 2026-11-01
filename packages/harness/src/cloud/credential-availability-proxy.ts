import {
  CredentialAvailabilityPort,
  EAdmissionCompletion,
  type AdmissionCompletion,
  type AdmissionDecision,
  type AdmissionPermit,
  type AvailabilityKey,
  type AvailabilitySnapshot,
  type CredentialRevision,
  type EAvailabilityControl,
  type NormalizedProviderFailure,
} from '@dltech/atlas-core'

import { cloudClientFor } from './cloud-client'
import type { CloudSession } from './cloud-session'
import { RemoteCredentialAvailability } from './remote-credential-availability'

export class RemoteSettlementUnreachableError extends Error {
  constructor() {
    super('the cloud session ended before a remote availability settlement could be delivered')
    this.name = 'RemoteSettlementUnreachableError'
  }
}

export class CredentialAvailabilityProxy extends CredentialAvailabilityPort {
  private readonly local: CredentialAvailabilityPort
  private readonly session: () => CloudSession | null
  private readonly clientVersion: string | undefined
  private remote: { token: string; port: CredentialAvailabilityPort } | undefined

  constructor(args: {
    local: CredentialAvailabilityPort
    session: () => CloudSession | null
    clientVersion?: string
  }) {
    super()
    this.local = args.local
    this.session = args.session
    this.clientVersion = args.clientVersion
  }

  inspect(args: {
    key: AvailabilityKey
    revision: CredentialRevision
  }): Promise<AvailabilitySnapshot> {
    return this.current().inspect(args)
  }

  admit(args: { key: AvailabilityKey; revision: CredentialRevision }): Promise<AdmissionDecision> {
    return this.current().admit(args)
  }

  async promoteProbe(args: {
    permit: AdmissionPermit
    failure: NormalizedProviderFailure
  }): Promise<void> {
    const authority = this.authorityOf(args.permit)
    if (authority === undefined) throw new RemoteSettlementUnreachableError()
    await authority.promoteProbe(args)
  }

  async complete(args: {
    permit: AdmissionPermit
    completion: AdmissionCompletion
  }): Promise<void> {
    const authority = this.authorityOf(args.permit)
    if (authority !== undefined) return authority.complete(args)
    if (args.completion.outcome === EAdmissionCompletion.Failed) {
      throw new RemoteSettlementUnreachableError()
    }
  }

  control(args: {
    key: AvailabilityKey
    revision: CredentialRevision
    action: EAvailabilityControl
  }): Promise<AvailabilitySnapshot> {
    return this.current().control(args)
  }

  private authorityOf(permit: AdmissionPermit): CredentialAvailabilityPort | undefined {
    if (permit.permitId === undefined) return this.local
    const current = this.current()
    return current === this.local ? undefined : current
  }

  private current(): CredentialAvailabilityPort {
    const session = this.session()
    if (session === null) {
      this.remote = undefined
      return this.local
    }

    if (this.remote?.token !== session.token) {
      this.remote = {
        token: session.token,
        port: new RemoteCredentialAvailability({
          client: cloudClientFor({
            session,
            ...(this.clientVersion === undefined ? {} : { clientVersion: this.clientVersion }),
          }),
        }),
      }
    }
    return this.remote.port
  }
}
