import type { SecretsPort } from '@dltech/atlas-core'

import type { FileSecretsStore } from '../secrets/file-secrets-store'
import { cloudClientFor } from './cloud-client'
import type { CloudSessionStore } from './cloud-session'
import { RemoteSecretsStore } from './remote-secrets-store'
import { CloudSignInRequiredError } from './sign-in-required'

export class SecretsStoreProxy implements SecretsPort {
  private readonly local: FileSecretsStore
  private readonly sessions: CloudSessionStore
  private readonly clientVersion: string | undefined
  private readonly cloudRequired: () => boolean
  private remote: { token: string; store: RemoteSecretsStore } | undefined

  constructor(args: {
    local: FileSecretsStore
    sessions: CloudSessionStore
    clientVersion?: string
    cloudRequired?: () => boolean
  }) {
    this.local = args.local
    this.sessions = args.sessions
    this.clientVersion = args.clientVersion
    this.cloudRequired = args.cloudRequired ?? (() => false)
  }

  async warm(): Promise<void> {
    const remote = this.activeRemote()
    if (remote !== undefined) await remote.warm()
  }

  origin(): string {
    return this.current().origin()
  }

  read(name: string): string | undefined {
    return this.current().read(name)
  }

  write(args: { name: string; value: string }): void {
    this.current().write(args)
  }

  remove(name: string): void {
    this.current().remove(name)
  }

  private current(): SecretsPort {
    const remote = this.activeRemote()
    if (remote !== undefined) return remote
    if (this.cloudRequired()) throw new CloudSignInRequiredError()
    return this.local
  }

  private activeRemote(): RemoteSecretsStore | undefined {
    const session = this.sessions.read()
    if (session === null) return undefined

    if (this.remote?.token !== session.token) {
      this.remote = {
        token: session.token,
        store: new RemoteSecretsStore({
          client: cloudClientFor({
            session,
            ...(this.clientVersion === undefined ? {} : { clientVersion: this.clientVersion }),
          }),
        }),
      }
    }

    return this.remote.store
  }
}
