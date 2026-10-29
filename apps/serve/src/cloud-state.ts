import { join } from 'node:path'

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
  cloudCall,
  decodeSettingValue,
  fileVaultBackend,
  SANDBOX_SERVE_TOKEN_PREFIX,
  SECRETS_VERSION,
  SecretCipher,
  type VaultFile,
} from '@dltech/atlas-harness'

import { createApiClient, httpStatusOf } from './api-client'
import { exportEnvSecrets, mergeCloudMcpServers, type CloudConfig } from './cloud-config'
import { writeAtomically } from './owner-only-file'
import { EServeEvent, type ServeLog } from './serve-log'

const UNAUTHORIZED = 401
const RETRY_DELAY_MS = 2_000
const DEFAULT_RETRY_BUDGET_MS = 60_000
const REQUEST_TIMEOUT_MS = 10_000
const MAX_ATTEMPTS = 30
const CLIENT_HELD_SECRET_PREFIXES = [`${SANDBOX_SERVE_TOKEN_PREFIX}:`, 'mcp-oauth:'] as const

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

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
    accounts: args.accounts.map((stored) => ({
      ...accountOf(stored),
      secret: box.seal(stored.secret),
    })),
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
  const sealed = Object.fromEntries(
    leased.map((secret) => [secret.name, args.cipher.encrypt(secret.value)]),
  )
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

export type CloudStateSeen = {
  lease?: string | undefined
  config?: string | undefined
  exported: Set<string>
}

export const applyCloudState = async (args: {
  atlasHome: string
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
  log: ServeLog
  env?: Record<string, string | undefined> | undefined
  projectId?: string | null | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
  retryBudgetMs?: number | undefined
  now?: (() => number) | undefined
  maxAttempts?: number | undefined
  seen?: CloudStateSeen | undefined
  onConfigWritten?: (() => void) | undefined
}): Promise<void> => {
  const sleep = args.sleep ?? defaultSleep
  const retryBudgetMs = args.retryBudgetMs ?? DEFAULT_RETRY_BUDGET_MS
  const now = args.now ?? Date.now
  const maxAttempts = args.maxAttempts ?? MAX_ATTEMPTS
  const url = args.controlPlaneUrl.replace(/\/+$/, '')

  const deadline = now() + retryBudgetMs

  const remainingMs = (): number => {
    const left = deadline - now()
    if (left <= 0) throw new Error(`Atlas Cloud state did not arrive within ${retryBudgetMs} ms`)
    return left
  }

  const isRegistering = (error: unknown): boolean =>
    (error instanceof CloudError && error.status === UNAUTHORIZED) ||
    httpStatusOf(error) === UNAUTHORIZED

  const patiently = async <T>(attempt: () => Promise<T>): Promise<T> => {
    for (let attempts = 1; ; attempts += 1) {
      try {
        return await attempt()
      } catch (error) {
        if (!isRegistering(error) || attempts >= maxAttempts || remainingMs() <= RETRY_DELAY_MS) {
          throw error
        }
        await sleep(RETRY_DELAY_MS)
      }
    }
  }

  const api = createApiClient({
    controlPlaneUrl: url,
    token: args.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn,
  })

  const attemptSignal = () => AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remainingMs()))

  const leasePatiently = () =>
    patiently(() => api.accountLease.get.query(undefined, { signal: attemptSignal() }))

  const legacyConfig = async (): Promise<CloudConfig> => {
    const [settings, secrets] = await Promise.all([
      patiently(() => api.settings.list.query(undefined, { signal: attemptSignal() })),
      patiently(() => api.secrets.list.query(undefined, { signal: attemptSignal() })),
    ])
    return {
      settings: settings.settings,
      secrets: secrets.secrets,
      mcpServers: [],
    }
  }

  const scopedConfig = async (): Promise<CloudConfig> => {
    const input = args.projectId ? { projectId: args.projectId } : undefined
    const resolved = await patiently(() =>
      cloudCall(api.sandboxConfig.get.query(input, { signal: attemptSignal() }), {
        allowMissing: true,
      }),
    )
    if (resolved === undefined) return legacyConfig()
    return {
      settings: Object.entries(resolved.settings).map(([key, value]) => ({ key, value })),
      secrets: resolved.secrets,
      mcpServers: resolved.mcpServers,
    }
  }

  try {
    const [lease, config] = await Promise.all([leasePatiently(), scopedConfig()])
    const leaseFingerprint = JSON.stringify(lease)
    const configFingerprint = JSON.stringify(config)
    const leaseChanged = args.seen?.lease !== leaseFingerprint
    const configChanged = args.seen?.config !== configFingerprint
    if (!leaseChanged && !configChanged) return
    const cipher = new SecretCipher(join(args.atlasHome, ATLAS_VAULT_KEY_NAME))
    const accounts = storedAccountsOf(lease.accounts)
    if (leaseChanged) {
      writeVault({ atlasHome: args.atlasHome, cipher, accounts, active: lease.active })
    }
    const secretCount = writeSecrets({ atlasHome: args.atlasHome, cipher, secrets: config.secrets })
    writeSettings({ atlasHome: args.atlasHome, settings: config.settings })
    mergeCloudMcpServers({ atlasHome: args.atlasHome, servers: config.mcpServers })
    const exported =
      args.env === undefined
        ? 0
        : exportEnvSecrets({
            env: args.env,
            secrets: config.secrets,
            exported: args.seen?.exported,
          })
    if (args.seen !== undefined) {
      args.seen.lease = leaseFingerprint
      args.seen.config = configFingerprint
    }
    args.onConfigWritten?.()
    args.log({
      event: EServeEvent.CloudStateReady,
      accounts: accounts.length,
      secrets: secretCount,
      settings: config.settings.length,
      ...(config.mcpServers.length === 0 ? {} : { mcpServers: config.mcpServers.length }),
      ...(exported === 0 ? {} : { envExported: exported }),
    })
  } catch (failure) {
    args.log({
      event: EServeEvent.CloudStateFailed,
      reason: failure instanceof Error ? failure.message : String(failure),
    })
  }
}
