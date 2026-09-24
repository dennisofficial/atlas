import { AccountStorePort, ClockPort, CredentialPort, ENoticeTone, ESettingId, NOTICE_WARN_MS, type NoticePort } from '@dltech/atlas-core'

import { CloudService } from '../cloud/cloud-service'
import type { CloudSettingsStore } from '../cloud/cloud-settings-store'
import { scheduleSecretsRewarm } from '../cloud/secrets-rewarm'
import { SecretsStoreProxy } from '../cloud/secrets-store-proxy'
import { registerDisposable } from '../container/disposal'
import { portToken, type DependencyContainer } from '../container/injection'
import {
  ClaudeCodeSourceToken,
  CloudSessionStoreToken,
  CloudSettingsStoreToken,
  CodexSourceToken,
  LocalAccountStoreToken,
  LocalSecretsStoreToken,
  SecretsStoreToken,
  UserSettingsStoreToken,
} from '../container/tokens'
import { AccountsService } from '../credentials/accounts-service'
import {
  ClaudeCodeSource,
  claudeCodePayloadStore,
  importClaudeCodeAccount,
} from '../credentials/claude-code-source'
import { importCodexAccount } from '../credentials/codex-source'
import { createSecurityKeychainReader } from '../credentials/keychain-reader'
import { syncEnvironmentAccounts } from '../credentials/environment-accounts'
import { builtinOauthClients } from '../credentials/oauth/refresh-client'
import { AnthropicUsageClient } from '../usage/anthropic-usage-client'
import { createAccountUsageService, type AccountUsageService } from '../usage/account-usage-service'

import { KeychainReaderToken } from '../container/tokens'

import { cloudOutageMessage } from './cloud-outage'

export function bindKeychainSource(args: {
  container: DependencyContainer
  launchValue: (id: ESettingId) => string | undefined
}): void {
  args.container.register(KeychainReaderToken, { useValue: createSecurityKeychainReader() })

  const keychainService = args.launchValue(ESettingId.KeychainService)
  if (keychainService === undefined) return

  args.container.register(ClaudeCodeSourceToken, {
    useFactory: (resolver) =>
      new ClaudeCodeSource(
        claudeCodePayloadStore({
          reader: resolver.resolve(KeychainReaderToken),
          service: keychainService,
        }),
      ),
  })
}

export async function bindAccounts(args: {
  container: DependencyContainer
  env: Record<string, string | undefined>
  notice: NoticePort
  cloudUrl: string | undefined
  clientVersion: string
}): Promise<{
  credentials: CredentialPort
  accounts: AccountsService
  cloud: CloudService
  cloudSettings: CloudSettingsStore
  usage: AccountUsageService
  rewarmSecrets: () => Promise<void>
}> {
  const { container, notice } = args

  const credentials = container.resolve(portToken(CredentialPort))
  const accountStore = container.resolve(portToken(AccountStorePort))
  const secrets = container.resolve(SecretsStoreToken)

  let rewarmSecrets: () => Promise<void> = () => Promise.resolve()

  if (secrets instanceof SecretsStoreProxy) {
    rewarmSecrets = () => secrets.warm()

    try {
      await secrets.warm()
    } catch (error) {
      notice.notify({
        key: 'cloud:secrets',
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
        text: `Atlas Cloud secrets could not be loaded (${error instanceof Error ? error.message : String(error)}) — cloud-backed keys stay unread until it comes back.`,
      })
    }

    const stopRewarm = scheduleSecretsRewarm({ warm: rewarmSecrets })
    registerDisposable({
      container,
      close: async () => {
        stopRewarm()
      },
    })
  }

  const cloudSettings = container.resolve(CloudSettingsStoreToken)

  const cloud = new CloudService({
    sessions: container.resolve(CloudSessionStoreToken),
    localAccounts: container.resolve(LocalAccountStoreToken),
    localSecrets: container.resolve(LocalSecretsStoreToken),
    ...(container.isRegistered(UserSettingsStoreToken, true)
      ? { localSettings: container.resolve(UserSettingsStoreToken) }
      : {}),
    defaultUrl: args.cloudUrl ?? 'http://localhost:3400',
    clientVersion: args.clientVersion,
  })

  try {
    await syncEnvironmentAccounts({ accounts: accountStore, env: args.env })
    await importClaudeCodeAccount({
      accounts: accountStore,
      source: container.resolve(ClaudeCodeSourceToken),
    })
    await importCodexAccount({
      accounts: accountStore,
      source: container.resolve(CodexSourceToken),
    })
  } catch (error) {
    const outage = cloudOutageMessage(error)
    if (outage === null) throw error

    notice.notify({
      key: 'cloud:accounts',
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text: `Atlas Cloud accounts could not be reconciled — ${outage.split('\n')[0] ?? ''}`,
    })
  }

  const accounts = new AccountsService({
    accounts: accountStore,
    clients: builtinOauthClients({ clock: container.resolve(portToken(ClockPort)) }),
  })
  const usage = createAccountUsageService({ usage: new AnthropicUsageClient({ credentials }) })

  return { credentials, accounts, cloud, cloudSettings, usage, rewarmSecrets }
}
