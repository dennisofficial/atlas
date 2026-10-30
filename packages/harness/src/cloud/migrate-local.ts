import {
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  type AccountId,
  type AccountStorePort,
  type StoredAccount,
} from '@dltech/atlas-core'
import { ENV_NAME_PATTERN, isHarnessLocalOnlyName } from '@dltech/atlas-wire'

import type { FileSecretsStore } from '../secrets/file-secrets-store'
import type { CloudClient } from './cloud-client'
import type { LocalArchive } from './local-archive'
import { accountDraftOf, sameAccountSecret } from './sync-accounts'

export type LocalMigration = { accounts: number; secrets: number }

const NOTHING_MIGRATED: LocalMigration = { accounts: 0, secrets: 0 }

const isMigratableAccount = (stored: StoredAccount): boolean =>
  stored.origin !== EAccountOrigin.Environment

const isMigratableSecret = (name: string): boolean =>
  !isHarnessLocalOnlyName(name) && !ENV_NAME_PATTERN.test(name)

const connectionOf = (stored: StoredAccount): string | undefined =>
  stored.secret.kind === EAuthKind.Oauth ? stored.secret.authority?.connectionId : undefined

export const sameCloudAccount = (held: StoredAccount, local: StoredAccount): boolean => {
  if (held.provider !== local.provider || held.secret.kind !== local.secret.kind) return false
  if (sameAccountSecret(held.secret, local.secret)) return true
  if (local.secret.kind === EAuthKind.ApiKey) return false

  const connection = connectionOf(local)
  if (connection !== undefined && connection === connectionOf(held)) return true
  return held.label === local.label && held.email !== undefined && held.email === local.email
}

const readAll = async (store: AccountStorePort): Promise<StoredAccount[]> => {
  const held: StoredAccount[] = []
  for (const account of await store.list()) {
    const stored = await store.read(account.id)
    if (stored !== undefined) held.push(stored)
  }
  return held
}

async function migrateAccounts(args: {
  cloud: AccountStorePort
  local: AccountStorePort
  archive: LocalArchive
}): Promise<number> {
  const candidates = (await readAll(args.local)).filter(isMigratableAccount)
  if (candidates.length === 0) return 0

  const held = await readAll(args.cloud)
  const cloudIds = new Map<AccountId, { id: AccountId; added: boolean }>()
  for (const stored of candidates) {
    const duplicate = held.find((candidate) => sameCloudAccount(candidate, stored))
    if (duplicate !== undefined) {
      cloudIds.set(stored.id, { id: duplicate.id, added: false })
      continue
    }
    const added = await args.cloud.add(accountDraftOf(stored))
    cloudIds.set(stored.id, { id: added.id, added: true })
  }

  for (const provider of Object.values(EAuthProvider)) {
    const active = await args.local.activeFor(provider)
    const mapped = active === undefined ? undefined : cloudIds.get(active)
    if (mapped === undefined) continue
    const current = await args.cloud.activeFor(provider)
    if (current !== undefined && !mapped.added) continue
    await args.cloud.setActive({ provider, accountId: mapped.id })
  }

  args.archive.archiveAccounts([...cloudIds.keys()])
  return cloudIds.size
}

async function migrateSecrets(args: {
  client: CloudClient
  localSecrets: FileSecretsStore | undefined
  archive: LocalArchive
}): Promise<number> {
  const names = args.localSecrets?.names().filter(isMigratableSecret) ?? []
  if (args.localSecrets === undefined || names.length === 0) return 0

  const heldNames = new Set((await args.client.listSecrets()).map((secret) => secret.name))
  for (const name of names) {
    if (heldNames.has(name)) continue
    const value = args.localSecrets.read(name)
    if (value === undefined) continue
    await args.client.putSecret({ name, value })
  }

  args.archive.archiveSecrets(names)
  return names.length
}

export async function migrateLocalToCloud(args: {
  client: CloudClient
  cloud: AccountStorePort
  local: AccountStorePort
  localSecrets: FileSecretsStore | undefined
  archive: LocalArchive
}): Promise<LocalMigration> {
  const accounts = await migrateAccounts(args)
  const secrets = await migrateSecrets(args)
  return accounts === 0 && secrets === 0 ? NOTHING_MIGRATED : { accounts, secrets }
}
