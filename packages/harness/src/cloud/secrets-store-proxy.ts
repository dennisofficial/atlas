import type { SecretsPort } from '@dltech/atlas-core'

import type { FileSecretsStore } from '../secrets/file-secrets-store'
import { CloudClient } from './cloud-client'
import type { CloudSessionStore } from './cloud-session'
import { RemoteSecretsStore } from './remote-secrets-store'

export class SecretsStoreProxy implements SecretsPort {
  private readonly local: FileSecretsStore
  private readonly sessions: CloudSessionStore
  private remote: { token: string; store: RemoteSecretsStore } | undefined

  constructor(args: { local: FileSecretsStore; sessions: CloudSessionStore }) {
    this.local = args.local
    this.sessions = args.sessions
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
    return this.activeRemote() ?? this.local
  }

  private activeRemote(): RemoteSecretsStore | undefined {
    const session = this.sessions.read()
    if (session === null) return undefined

    if (this.remote?.token !== session.token) {
      this.remote = {
        token: session.token,
        store: new RemoteSecretsStore({
          client: new CloudClient({ url: session.url, token: session.token }),
        }),
      }
    }

    return this.remote.store
  }
}
