import {
  accountIdSchema,
  accountSchema,
  EAuthProvider,
  storedAccountSchema,
  type Account,
  type AccountId,
  type StoredAccount,
} from '@dltech/atlas-core'
import { z } from 'zod'

import type { SealedSnapshotFile } from './sealed-snapshot-file'

const snapshotSchema = z.object({
  list: z.array(accountSchema).optional(),
  stored: z.record(z.string(), storedAccountSchema.nullable()),
  active: z.partialRecord(z.enum(EAuthProvider), accountIdSchema.nullable()),
})

type Snapshot = z.infer<typeof snapshotSchema>

const emptySnapshot = (): Snapshot => ({ stored: {}, active: {} })

export type Recalled<T> = { value: T } | undefined

export class AccountSnapshot {
  private readonly file: SealedSnapshotFile
  private readonly url: string
  private held: Snapshot | undefined

  constructor(args: { file: SealedSnapshotFile; url: string }) {
    this.file = args.file
    this.url = args.url
  }

  recallList(): Recalled<readonly Account[]> {
    const list = this.load().list
    return list === undefined ? undefined : { value: list }
  }

  recallRead(accountId: AccountId): Recalled<StoredAccount | undefined> {
    const stored = this.load().stored
    if (!(accountId in stored)) return undefined
    return { value: stored[accountId] ?? undefined }
  }

  recallActive(provider: EAuthProvider): Recalled<AccountId | undefined> {
    const active = this.load().active
    if (!(provider in active)) return undefined
    return { value: active[provider] ?? undefined }
  }

  recordList(list: readonly Account[]): void {
    const held = this.load()
    const ids = new Set(list.map((account) => account.id))
    const stored = Object.fromEntries(
      Object.entries(held.stored).filter(([id]) => ids.has(id as AccountId)),
    )
    this.save({ ...held, list: [...list], stored })
  }

  recordRead(args: { accountId: AccountId; stored: StoredAccount | undefined }): void {
    const held = this.load()
    this.save({
      ...held,
      stored: { ...held.stored, [args.accountId]: args.stored ?? null },
    })
  }

  recordActive(args: { provider: EAuthProvider; accountId: AccountId | undefined }): void {
    const held = this.load()
    this.save({
      ...held,
      active: { ...held.active, [args.provider]: args.accountId ?? null },
    })
  }

  forget(): void {
    this.held = emptySnapshot()
    this.file.remove()
  }

  private load(): Snapshot {
    if (this.held !== undefined) return this.held
    const parsed = snapshotSchema.safeParse(this.file.read({ url: this.url }))
    this.held = parsed.success ? parsed.data : emptySnapshot()
    return this.held
  }

  private save(snapshot: Snapshot): void {
    this.held = snapshot
    this.file.write({ url: this.url, value: snapshot })
  }
}
