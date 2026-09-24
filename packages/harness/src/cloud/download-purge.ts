import {
  EAuthKind,
  EAuthProvider,
  type AccountDraft,
  type AccountId,
  type AccountSecret,
  type AccountStorePort,
  type StoredAccount,
} from '@dltech/atlas-core'

import { writeUserMcpServer } from '../mcp/config/writer'
import type { FileSecretsStore } from '../secrets/file-secrets-store'
import { atlasDirectory } from '../store/paths'
import { CloudError, type CloudClient } from './cloud-client'
import { downloadMemoryArchive } from './download-memory-archive'
import { CLOUD_PURGE_DOMAINS, type CloudPurgeDomainId } from './purge-domains'
import type { UserContextClient } from './user-context-client'

export type CloudPurgeResult = {
  accounts: number
  secrets: number
  mcpServers: number
  memoryFiles: number
  githubDisconnected: boolean
}

export type CloudSyncCounts = {
  accounts: number
  secrets: number
  mcpServers: number
}

export { CLOUD_PURGE_DOMAINS } from './purge-domains'
export type { CloudPurgeDomain, CloudPurgeDomainId } from './purge-domains'

export type CloudPurgeStores = {
  accounts: AccountStorePort
  secrets: FileSecretsStore | undefined
  context: Pick<UserContextClient, 'readMemoryArchive' | 'readMemoryBundle'>
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export const sameAccountSecret = (a: AccountSecret, b: AccountSecret): boolean => {
  if (a.kind !== b.kind) return false
  if (a.kind === EAuthKind.ApiKey && b.kind === EAuthKind.ApiKey) return a.apiKey === b.apiKey
  if (a.kind === EAuthKind.Oauth && b.kind === EAuthKind.Oauth) {
    return (
      a.tokens.accessToken === b.tokens.accessToken &&
      a.tokens.refreshToken === b.tokens.refreshToken
    )
  }
  return false
}

export const accountDraftOf = (stored: StoredAccount): AccountDraft => ({
  provider: stored.provider,
  label: stored.label,
  secret: stored.secret,
  origin: stored.origin,
  ...(stored.email === undefined ? {} : { email: stored.email }),
  ...(stored.subscription === undefined ? {} : { subscription: stored.subscription }),
  ...(stored.importedFrom === undefined ? {} : { importedFrom: stored.importedFrom }),
})

/**
 * Lands every cloud account locally before any remote delete runs. `add` mints fresh local ids,
 * so the cloud→local id map is what lets the active pointers follow; an account whose secret is
 * already held locally (a retried purge) is matched to the existing entry instead of duplicated.
 */
export const downloadAccounts = async (args: {
  client: CloudClient
  store: AccountStorePort
  purge: boolean
}): Promise<number> => {
  const remote = await args.client.listAccounts()

  const held: StoredAccount[] = []
  for (const account of await args.store.list()) {
    const stored = await args.store.read(account.id)
    if (stored !== undefined) held.push(stored)
  }

  const localIds = new Map<AccountId, AccountId>()
  for (const account of remote) {
    const stored = await args.client.readAccount({ accountId: account.id })
    if (stored === undefined) continue

    const existing = held.find(
      (local) =>
        local.provider === stored.provider &&
        local.label === stored.label &&
        sameAccountSecret(local.secret, stored.secret),
    )
    if (existing !== undefined) {
      localIds.set(account.id, existing.id)
      continue
    }

    const added = await args.store.add(accountDraftOf(stored))
    held.push({ ...stored, id: added.id })
    localIds.set(account.id, added.id)
  }

  for (const provider of Object.values(EAuthProvider)) {
    const active = await args.client.activeAccount({ provider })
    if (active === undefined) continue

    const localId = localIds.get(active)
    if (localId === undefined) continue

    await args.store.setActive({ provider, accountId: localId })
  }

  if (args.purge) {
    for (const account of remote) {
      await args.client.removeAccount({ accountId: account.id })
    }
  }

  return localIds.size
}

export const downloadSecrets = async (args: {
  client: CloudClient
  store: FileSecretsStore | undefined
  purge: boolean
}): Promise<number> => {
  const remote = await args.client.listSecrets()
  if (remote.length === 0) return 0
  if (args.store === undefined) {
    throw new CloudError({
      status: 0,
      message: 'this Atlas has no local secrets store to land the cloud secrets in',
    })
  }

  for (const secret of remote) {
    args.store.write({ name: secret.name, value: secret.value })
  }
  if (args.purge) {
    for (const secret of remote) {
      await args.client.deleteSecret({ name: secret.name })
    }
  }
  return remote.length
}

export const downloadMcpServers = async (args: {
  client: CloudClient
  purge: boolean
}): Promise<number> => {
  const remote = await args.client.listMcpServers()

  for (const server of remote) {
    await writeUserMcpServer({
      name: server.name,
      ...(server.transport === undefined ? {} : { transport: server.transport }),
      ...(server.disabled === undefined ? {} : { disabled: server.disabled }),
    })
  }
  if (args.purge) {
    for (const server of remote) {
      await args.client.deleteMcpServer({ name: server.name })
    }
  }
  return remote.length
}

/**
 * The download half of the purge, without the deletes: everything the cloud holds lands in the
 * local stores and the remote copy stays put — the explicit "go local" pull.
 */
export async function downloadCloudData(args: {
  client: CloudClient
  stores: { accounts: AccountStorePort; secrets: FileSecretsStore | undefined }
}): Promise<CloudSyncCounts> {
  return {
    accounts: await downloadAccounts({
      client: args.client,
      store: args.stores.accounts,
      purge: false,
    }),
    secrets: await downloadSecrets({ client: args.client, store: args.stores.secrets, purge: false }),
    mcpServers: await downloadMcpServers({ client: args.client, purge: false }),
  }
}

const downloadMemory = async (args: {
  client: CloudClient
  context: CloudPurgeStores['context']
}): Promise<number> => {
  const downloaded = await downloadMemoryArchive({
    context: args.context,
    atlasHome: atlasDirectory(),
  })
  await args.client.deleteMemory()
  return downloaded.restored
}

const disconnectGithub = async (args: { client: CloudClient }): Promise<boolean> => {
  const connection = await args.client.githubConnection()
  if (connection === null) return false
  await args.client.disconnectGithub()
  return true
}

const failureMessage = (args: {
  landed: readonly string[]
  domain: string
  cause: unknown
}): string => {
  const soFar =
    args.landed.length === 0
      ? 'Nothing was moved yet'
      : `Moved ${args.landed.join(', ')} to this machine`
  return `${soFar}, then the ${args.domain} step failed: ${messageOf(args.cause)}. What landed stays on this machine; the rest is still in the cloud and you are still signed in, so it is safe to retry.`
}

/**
 * The mirror of finishLogin's local→cloud copy: per domain, download-and-land locally first and
 * only then delete server-side, so a failure mid-way never strands data. Domain order is
 * accounts → secrets → mcp servers → memory → github connection; every domain is re-runnable,
 * so a retry after a partial run picks up what is left.
 */
export async function downloadAndPurgeCloudData(args: {
  client: CloudClient
  stores: CloudPurgeStores
}): Promise<CloudPurgeResult> {
  const result: CloudPurgeResult = {
    accounts: 0,
    secrets: 0,
    mcpServers: 0,
    memoryFiles: 0,
    githubDisconnected: false,
  }
  const landed: string[] = []

  const runs: Record<CloudPurgeDomainId, () => Promise<void>> = {
    accounts: async () => {
      result.accounts = await downloadAccounts({
        client: args.client,
        store: args.stores.accounts,
        purge: true,
      })
    },
    secrets: async () => {
      result.secrets = await downloadSecrets({
        client: args.client,
        store: args.stores.secrets,
        purge: true,
      })
    },
    mcpServers: async () => {
      result.mcpServers = await downloadMcpServers({ client: args.client, purge: true })
    },
    memory: async () => {
      result.memoryFiles = await downloadMemory({ client: args.client, context: args.stores.context })
    },
    github: async () => {
      result.githubDisconnected = await disconnectGithub({ client: args.client })
    },
  }

  for (const domain of CLOUD_PURGE_DOMAINS) {
    try {
      await runs[domain.id]()
      if (domain.count !== undefined) {
        const moved = domain.count(result)
        if (moved > 0) landed.push(domain.movedLabel(moved))
      }
    } catch (cause) {
      throw new CloudError({
        status: cause instanceof CloudError ? cause.status : 0,
        message: failureMessage({ landed, domain: domain.step, cause }),
      })
    }
  }

  return result
}
