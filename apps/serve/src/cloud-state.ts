import { join } from 'node:path'

import {
  accountOf,
  EAuthProvider,
  serialiseSettingsDocument,
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
  decodeSettingValue,
  fileVaultBackend,
  SANDBOX_SERVE_TOKEN_PREFIX,
  storedAccountOfDto,
  SECRETS_VERSION,
  SecretCipher,
  type VaultFile,
} from '@dltech/atlas-harness'

import { fetchCloudState, type CloudStateFetched } from './cloud-state-fetch'
import { exportEnvSecrets, mergeCloudMcpServers } from './cloud-config'
import {
  mountProjectFiles,
  EFileMountState,
  type FileMountGit,
  type FileMountReport,
  type FileMountRoots,
} from './file-mounts'
import { writeAtomically } from './owner-only-file'
import { EServeEvent, type ServeLog } from './serve-log'

const CLIENT_HELD_SECRET_PREFIXES = [`${SANDBOX_SERVE_TOKEN_PREFIX}:`, 'mcp-oauth:'] as const

const isProviderKnown = (provider: string): provider is EAuthProvider =>
  Object.values<string>(EAuthProvider).includes(provider)

const storedAccountsOf = (entries: readonly unknown[]): StoredAccount[] =>
  entries.flatMap((entry) => {
    try {
      return [storedAccountOfDto(entry)]
    } catch {
      return []
    }
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

const WRITTEN_STATES: ReadonlySet<EFileMountState> = new Set([
  EFileMountState.Written,
  EFileMountState.WrittenLocallyExcluded,
  EFileMountState.WrittenNotExcluded,
])

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
  fileMountRoots?: FileMountRoots | undefined
  mountGit?: FileMountGit | undefined
  prefetched?: Promise<CloudStateFetched> | undefined
}): Promise<FileMountReport | null> => {
  try {
    const { lease, config } = await (args.prefetched ?? fetchCloudState(args))
    const leaseFingerprint = JSON.stringify(lease)
    const configFingerprint = JSON.stringify(config)
    const leaseChanged = args.seen?.lease !== leaseFingerprint
    const configChanged = args.seen?.config !== configFingerprint
    if (!leaseChanged && !configChanged) return null
    const cipher = new SecretCipher(join(args.atlasHome, ATLAS_VAULT_KEY_NAME))
    const accounts = storedAccountsOf(lease.accounts)
    if (leaseChanged) {
      writeVault({
        atlasHome: args.atlasHome,
        cipher,
        accounts,
        active: lease.active,
      })
    }
    const secretCount = writeSecrets({
      atlasHome: args.atlasHome,
      cipher,
      secrets: config.harnessSecrets,
    })
    writeSettings({ atlasHome: args.atlasHome, settings: config.settings })
    mergeCloudMcpServers({
      atlasHome: args.atlasHome,
      servers: config.mcpServers,
    })
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
    const mounted =
      args.fileMountRoots === undefined || config.fileMounts.length === 0
        ? null
        : await mountProjectFiles({
            mounts: config.fileMounts,
            ...args.fileMountRoots,
            git: args.mountGit,
          })
    const filesMounted = (mounted?.outcomes ?? []).filter((outcome) =>
      WRITTEN_STATES.has(outcome.state),
    ).length
    args.log({
      event: EServeEvent.CloudStateReady,
      accounts: accounts.length,
      secrets: secretCount,
      settings: config.settings.length,
      ...(config.mcpServers.length === 0 ? {} : { mcpServers: config.mcpServers.length }),
      ...(exported === 0 ? {} : { envExported: exported }),
      ...(mounted === null ? {} : { filesMounted }),
    })
    for (const outcome of mounted?.outcomes ?? []) {
      if (WRITTEN_STATES.has(outcome.state)) continue
      args.log({
        event: EServeEvent.FileMountSkipped,
        path: outcome.path,
        state: outcome.state,
        ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
      })
    }
    return mounted
  } catch (failure) {
    args.log({
      event: EServeEvent.CloudStateFailed,
      reason: failure instanceof Error ? failure.message : String(failure),
    })
    return null
  }
}
