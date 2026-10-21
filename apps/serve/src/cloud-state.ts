import { randomBytes } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  accountOf,
  EAuthProvider,
  serialiseSettingsDocument,
  storedAccountSchema,
  toAccountId,
  type JsonValue,
  type StoredAccount,
} from '@dltech/atlas-core'
import {
  ATLAS_SETTINGS_NAME,
  ATLAS_VAULT_KEY_NAME,
  ATLAS_VAULT_NAME,
  ATLAS_SECRETS_NAME,
  cipherSecretBox,
  CloudError,
  cloudRequest,
  decodeSettingValue,
  fileVaultBackend,
  SANDBOX_SERVE_TOKEN_PREFIX,
  SECRETS_VERSION,
  SecretCipher,
  type VaultFile,
} from '@dltech/atlas-harness'
import { accountLeaseSchema } from '@dltech/atlas-wire'
import { z } from 'zod'

import { EServeEvent, type ServeLog } from './serve-log'

const UNAUTHORIZED = 401
const RETRY_DELAY_MS = 2_000
const DEFAULT_RETRY_BUDGET_MS = 60_000
const OWNER_ONLY = 0o600
const CLIENT_HELD_SECRET_PREFIXES = [`${SANDBOX_SERVE_TOKEN_PREFIX}:`, 'mcp-oauth:'] as const

const settingsResponseSchema = z.object({
  settings: z.array(z.object({ key: z.string(), value: z.string() })),
})
const secretsResponseSchema = z.object({
  secrets: z.array(z.object({ name: z.string(), value: z.string() })),
})

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const writeAtomically = (args: { path: string; content: string }): void => {
  mkdirSync(dirname(args.path), { recursive: true })
  const staging = join(dirname(args.path), `.${randomBytes(8).toString('hex')}.tmp`)
  writeFileSync(staging, args.content, { mode: OWNER_ONLY })
  renameSync(staging, args.path)
}

const isProviderKnown = (provider: string): provider is EAuthProvider =>
  Object.values<string>(EAuthProvider).includes(provider)

const storedAccountsOf = (entries: readonly unknown[]): StoredAccount[] =>
  entries.flatMap((entry) => {
    const parsed = storedAccountSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })

const writeVault = (args: {
  atlasHome: string
  cipher: SecretCipher
  accounts: readonly StoredAccount[]
  active: readonly { provider: string; accountId: string }[]
}): void => {
  const file = join(args.atlasHome, ATLAS_VAULT_NAME)
  const box = cipherSecretBox({ cipher: args.cipher, where: file })
  const held = new Set<string>(args.accounts.map((account) => account.id))
  const active: VaultFile['active'] = Object.fromEntries(
    args.active
      .filter((pointer) => isProviderKnown(pointer.provider) && held.has(pointer.accountId))
      .map((pointer) => [pointer.provider, toAccountId(pointer.accountId)]),
  )
  fileVaultBackend(file).save({
    version: 2,
    accounts: args.accounts.map((stored) => ({ ...accountOf(stored), secret: box.seal(stored.secret) })),
    active,
  })
}

const writeSecrets = (args: {
  atlasHome: string
  cipher: SecretCipher
  secrets: readonly { name: string; value: string }[]
}): number => {
  const leased = args.secrets.filter(
    (secret) =>
      secret.value.length > 0 &&
      !CLIENT_HELD_SECRET_PREFIXES.some((prefix) => secret.name.startsWith(prefix)),
  )
  const sealed = Object.fromEntries(leased.map((secret) => [secret.name, args.cipher.encrypt(secret.value)]))
  writeAtomically({
    path: join(args.atlasHome, ATLAS_SECRETS_NAME),
    content: `${JSON.stringify({ version: SECRETS_VERSION, secrets: sealed }, null, 2)}\n`,
  })
  return leased.length
}

const writeSettings = (args: {
  atlasHome: string
  settings: readonly { key: string; value: string }[]
}): void => {
  const values: Record<string, JsonValue> = {}
  for (const setting of args.settings) values[setting.key] = decodeSettingValue(setting.value)
  writeAtomically({
    path: join(args.atlasHome, ATLAS_SETTINGS_NAME),
    content: serialiseSettingsDocument({ values }),
  })
}

export const applyCloudState = async (args: {
  atlasHome: string
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
  log: ServeLog
  sleep?: ((ms: number) => Promise<void>) | undefined
  retryBudgetMs?: number | undefined
  now?: (() => number) | undefined
}): Promise<void> => {
  const sleep = args.sleep ?? defaultSleep
  const retryBudgetMs = args.retryBudgetMs ?? DEFAULT_RETRY_BUDGET_MS
  const now = args.now ?? Date.now
  const url = args.controlPlaneUrl.replace(/\/+$/, '')

  const request = (path: string): Promise<unknown> =>
    cloudRequest({
      url,
      token: args.token,
      clientVersion: args.clientVersion,
      fetchFn: args.fetchFn,
      method: 'GET',
      path,
      retry: true,
    })

  const requestPatiently = async (path: string): Promise<unknown> => {
    const startedAt = now()
    for (;;) {
      try {
        return await request(path)
      } catch (error) {
        const registering = error instanceof CloudError && error.status === UNAUTHORIZED
        if (!registering || now() - startedAt + RETRY_DELAY_MS > retryBudgetMs) throw error
        await sleep(RETRY_DELAY_MS)
      }
    }
  }

  try {
    const [lease, settings, secrets] = await Promise.all([
      requestPatiently('/v1/account-lease').then((body) => accountLeaseSchema.parse(body)),
      requestPatiently('/v1/settings').then((body) => settingsResponseSchema.parse(body)),
      requestPatiently('/v1/secrets').then((body) => secretsResponseSchema.parse(body)),
    ])
    const cipher = new SecretCipher(join(args.atlasHome, ATLAS_VAULT_KEY_NAME))
    const accounts = storedAccountsOf(lease.accounts)
    writeVault({ atlasHome: args.atlasHome, cipher, accounts, active: lease.active })
    const secretCount = writeSecrets({ atlasHome: args.atlasHome, cipher, secrets: secrets.secrets })
    writeSettings({ atlasHome: args.atlasHome, settings: settings.settings })
    args.log({
      event: EServeEvent.CloudStateReady,
      accounts: accounts.length,
      secrets: secretCount,
      settings: settings.settings.length,
    })
  } catch (failure) {
    args.log({
      event: EServeEvent.CloudStateFailed,
      reason: failure instanceof Error ? failure.message : String(failure),
    })
  }
}
