import {
  CredentialPort,
  type Credential,
  type CredentialRequest,
} from '@dltech/atlas-core'

import { BrokeredCredentialPort } from '../credentials/brokered-credential-port'
import type { RefreshingCredentialPort } from '../credentials/refreshing-credential-port'
import type { CloudSessionStore } from './cloud-session'

/**
 * Signed in, credentials come from the cloud broker — the only refresher. Signed out,
 * the local refreshing port serves credentials from the local vault.
 */
export class CredentialPortProxy extends CredentialPort {
  private readonly local: RefreshingCredentialPort
  private readonly sessions: CloudSessionStore
  private readonly brokered: BrokeredCredentialPort

  constructor(args: {
    local: RefreshingCredentialPort
    sessions: CloudSessionStore
    brokered: BrokeredCredentialPort
  }) {
    super()
    this.local = args.local
    this.sessions = args.sessions
    this.brokered = args.brokered
  }

  read(request?: CredentialRequest): Promise<Credential> {
    return this.current().read(request)
  }

  discard(credential: Credential): Promise<void> {
    return this.current().discard(credential)
  }

  private current(): CredentialPort {
    return this.sessions.read() === null ? this.local : this.brokered
  }
}
