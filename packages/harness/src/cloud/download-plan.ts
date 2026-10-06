import {
  authorityOf,
  EAuthKind,
  EAuthProvider,
  type AccountId,
  type JsonValue,
  type StoredAccount,
} from '@dltech/atlas-core'

import { mcpSpecSchema } from '../mcp/config/specs'
import { writeUserMcpServer } from '../mcp/config/writer'
import { CloudError, type CloudClient, type CloudMcpServer } from './cloud-client'
import {
  accountDraftOf,
  sameAccountSecret,
  type CloudSyncCounts,
  type CloudSyncStores,
} from './sync-accounts'
import { decodeSettingValue } from './sync-settings'

type DownloadPlan = {
  accounts: StoredAccount[]
  actives: { provider: EAuthProvider; accountId: AccountId }[]
  secrets: { name: string; value: string }[]
  mcpServers: CloudMcpServer[]
  settings: { key: string; value: JsonValue }[]
}

const planFailure = (message: string): CloudError => new CloudError({ status: 0, message })

const fetchDownloadPlan = async (args: { client: CloudClient }): Promise<DownloadPlan> => {
  const listed = await args.client.listAccounts()

  const accounts: StoredAccount[] = []
  const knownIds = new Set<string>()
  for (const summary of listed) {
    const stored = await args.client.readAccount({ accountId: summary.id })
    if (stored === undefined) {
      throw planFailure(`the cloud listed account ${summary.id} but would not return its body`)
    }
    if (stored.id !== summary.id) {
      throw planFailure(
        `the cloud returned account body ${stored.id} when asked for ${summary.id} — the download was refused; nothing local was changed`,
      )
    }
    accounts.push(stored)
    knownIds.add(stored.id)
  }

  const actives: DownloadPlan['actives'] = []
  for (const provider of Object.values(EAuthProvider)) {
    const active = await args.client.activeAccount({ provider })
    if (active === undefined) continue
    if (!knownIds.has(active)) {
      throw planFailure(
        `the cloud's active ${provider} account ${active} is not in its account list — the download was refused; nothing local was changed`,
      )
    }
    actives.push({ provider, accountId: active })
  }

  const secrets = (await args.client.listSecrets()).map((secret) => ({
    name: secret.name,
    value: secret.value,
  }))

  const mcpServers: CloudMcpServer[] = []
  for (const server of await args.client.listMcpServers()) {
    const parsed = mcpSpecSchema.safeParse({
      name: server.name,
      ...(server.transport === undefined ? {} : { transport: server.transport }),
      ...(server.disabled === undefined ? {} : { disabled: server.disabled }),
    })
    if (!parsed.success) {
      throw planFailure(
        `the cloud's MCP server "${server.name}" is malformed (${parsed.error.issues[0]?.message ?? 'invalid spec'}) — the download was refused; nothing local was changed`,
      )
    }
    mcpServers.push(server)
  }

  const settings = (await args.client.listSettings()).map((setting) => ({
    key: setting.key,
    value: decodeSettingValue(setting.value),
  }))

  return { accounts, actives, secrets, mcpServers, settings }
}

const requireLocalStores = (args: { plan: DownloadPlan; stores: CloudSyncStores }): void => {
  if (args.plan.secrets.length > 0 && args.stores.secrets === undefined) {
    throw planFailure('this Atlas has no local secrets store to land the cloud secrets in')
  }
  if (args.plan.settings.length > 0 && args.stores.settings === undefined) {
    throw planFailure('this Atlas has no local settings store to land the cloud settings in')
  }
}

const applyAccounts = async (args: {
  plan: DownloadPlan
  store: CloudSyncStores['accounts']
}): Promise<number> => {
  const held: StoredAccount[] = []
  for (const account of await args.store.list()) {
    const stored = await args.store.read(account.id)
    if (stored !== undefined) held.push(stored)
  }

  const localIds = new Map<AccountId, AccountId>()
  for (const stored of args.plan.accounts) {
    if (stored.secret.kind === EAuthKind.Oauth && authorityOf(stored.secret) === undefined) continue

    const existing = held.find(
      (local) =>
        local.provider === stored.provider &&
        local.label === stored.label &&
        sameAccountSecret(local.secret, stored.secret),
    )
    if (existing !== undefined) {
      localIds.set(stored.id, existing.id)
      continue
    }

    const added = await args.store.add(accountDraftOf(stored))
    held.push({ ...stored, id: added.id })
    localIds.set(stored.id, added.id)
  }

  for (const active of args.plan.actives) {
    const localId = localIds.get(active.accountId)
    if (localId === undefined) continue
    await args.store.setActive({ provider: active.provider, accountId: localId })
  }

  return localIds.size
}

const applyDownloadPlan = async (args: {
  plan: DownloadPlan
  stores: CloudSyncStores
}): Promise<CloudSyncCounts> => {
  requireLocalStores({ plan: args.plan, stores: args.stores })

  const accounts = await applyAccounts({ plan: args.plan, store: args.stores.accounts })

  for (const secret of args.plan.secrets) {
    args.stores.secrets?.write({ name: secret.name, value: secret.value })
  }

  for (const server of args.plan.mcpServers) {
    await writeUserMcpServer({
      name: server.name,
      ...(server.transport === undefined ? {} : { transport: server.transport }),
      ...(server.disabled === undefined ? {} : { disabled: server.disabled }),
    })
  }

  if (args.plan.settings.length > 0 && args.stores.settings !== undefined) {
    const document = args.stores.settings.read().document
    const merged: Record<string, JsonValue> = { ...document.values }
    for (const setting of args.plan.settings) {
      merged[setting.key] = setting.value
    }
    args.stores.settings.write({ values: merged })
  }

  return {
    accounts,
    secrets: args.plan.secrets.length,
    mcpServers: args.plan.mcpServers.length,
    settings: args.plan.settings.length,
  }
}

export async function downloadCloudData(args: {
  client: CloudClient
  stores: CloudSyncStores
}): Promise<CloudSyncCounts> {
  const plan = await fetchDownloadPlan({ client: args.client })
  return applyDownloadPlan({ plan, stores: args.stores })
}
