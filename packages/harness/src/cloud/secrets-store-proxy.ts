import { ENoticeTone, type NoticePort, type SecretsPort } from '@dltech/atlas-core'
import { isHarnessLocalOnlyName } from '@dltech/atlas-wire'

import type { FileSecretsStore } from '../secrets/file-secrets-store'
import { cloudClientFor } from './cloud-client'
import type { CloudSessionStore } from './cloud-session'
import { RemoteSecretsStore, type SecretsSnapshot } from './remote-secrets-store'
import type { SealedSnapshotFile } from './sealed-snapshot-file'

const secretsSnapshotOf = (args: { file: SealedSnapshotFile; url: string }): SecretsSnapshot => ({
  recall: () => {
    const held = args.file.read({ url: args.url })
    if (typeof held !== 'object' || held === null) return undefined
    const entries = Object.entries(held).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    )
    return new Map(entries)
  },
  record: (values) => args.file.write({ url: args.url, value: Object.fromEntries(values) }),
})

export const isLocalOnlySecret = isHarnessLocalOnlyName

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
  private readonly snapshotFile: SealedSnapshotFile | undefined
  private remote: { token: string; store: RemoteSecretsStore } | undefined

  constructor(args: {
    local: FileSecretsStore
    sessions: CloudSessionStore
    clientVersion?: string
    notice?: NoticePort | undefined
    snapshotFile?: SealedSnapshotFile | undefined
  }) {
    this.local = args.local
    this.sessions = args.sessions
    this.clientVersion = args.clientVersion
    this.notice = args.notice
    this.snapshotFile = args.snapshotFile
    this.sessions.onCleared(() => {
      this.remote = undefined
      this.snapshotFile?.remove()
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
    return this.routed(name).read(name)
  }

  write(args: { name: string; value: string }): void {
    this.routed(args.name).write(args)
  }

  remove(name: string): void {
    this.routed(name).remove(name)
  }

  private routed(name: string): SecretsPort {
    return isLocalOnlySecret(name) ? this.local : this.current()
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
      const store = new RemoteSecretsStore({
        client: cloudClientFor({
          session,
          ...(this.clientVersion === undefined ? {} : { clientVersion: this.clientVersion }),
        }),
        ...(this.snapshotFile === undefined
          ? {}
          : {
              snapshot: secretsSnapshotOf({
                file: this.snapshotFile,
                url: session.url,
              }),
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
      })
      this.remote = { token: session.token, store }
      void store.warm().catch(() => undefined)
    }

    return this.remote.store
  }
}
