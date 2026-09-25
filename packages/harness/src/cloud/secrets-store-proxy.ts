import { ENoticeTone, type NoticePort, type SecretsPort } from '@dltech/atlas-core'

import type { FileSecretsStore } from '../secrets/file-secrets-store'
import { cloudClientFor } from './cloud-client'
import type { CloudSessionStore } from './cloud-session'
import { RemoteSecretsStore } from './remote-secrets-store'

/**
 * A cleared session — logout or a refused token — retires the remote store on the spot: its warmed
 * values were the cloud's, and letting them answer behind a session that no longer exists would
 * keep the cloud's secrets alive past their sign-out.
 */
export class SecretsStoreProxy implements SecretsPort {
  private readonly local: FileSecretsStore
  private readonly sessions: CloudSessionStore
  private readonly clientVersion: string | undefined
  private readonly notice: NoticePort | undefined
  private remote: { token: string; store: RemoteSecretsStore } | undefined

  constructor(args: {
    local: FileSecretsStore
    sessions: CloudSessionStore
    clientVersion?: string
    notice?: NoticePort | undefined
  }) {
    this.local = args.local
    this.sessions = args.sessions
    this.clientVersion = args.clientVersion
    this.notice = args.notice
    this.sessions.onCleared(() => {
      this.remote = undefined
    })
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
          ...(this.notice === undefined
            ? {}
            : {
                onWriteFailure: ({ name, failure }) => {
                  this.notice?.notify({
                    key: 'cloud:secrets-write-behind',
                    tone: ENoticeTone.Warn,
                    ttlMs: null,
                    text: `a write to Atlas Cloud secrets failed for ${name} (${failure.message}) — the value lives on this machine only until the cloud takes it. A successful write or re-warm replaces this notice.`,
                  })
                },
              }),
        }),
      }
    }

    return this.remote.store
  }
}
