import {
  AccountStorePort,
  ClockPort,
  CredentialPort,
  ESettingId,
} from '@dltech/atlas-core'

import { CloudService } from '../cloud/cloud-service'
import { portToken, type DependencyContainer } from '../container/injection'
import {
  ClaudeCodeSourceToken,
  CloudSessionStoreToken,
  CodexSourceToken,
  LocalAccountStoreToken,
  LocalSecretsStoreToken,
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
  cloudUrl: string | undefined
  clientVersion: string
  /** False in serve, where the vault was transferred with the sandbox and host sources must not touch it. */
  reconcileHostSources?: boolean
}): Promise<{
  credentials: CredentialPort
  accounts: AccountsService
  cloud: CloudService
  usage: AccountUsageService
}> {
  const { container } = args

  const credentials = container.resolve(portToken(CredentialPort))
  const accountStore = container.resolve(portToken(AccountStorePort))

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

  if (args.reconcileHostSources !== false) {
    await syncEnvironmentAccounts({ accounts: accountStore, env: args.env })
    await importClaudeCodeAccount({
      accounts: accountStore,
      source: container.resolve(ClaudeCodeSourceToken),
    })
    await importCodexAccount({
      accounts: accountStore,
      source: container.resolve(CodexSourceToken),
    })
  }

  const accounts = new AccountsService({
    accounts: accountStore,
    clients: builtinOauthClients({ clock: container.resolve(portToken(ClockPort)) }),
  })
  const usage = createAccountUsageService({ usage: new AnthropicUsageClient({ credentials }) })

  return { credentials, accounts, cloud, usage }
}
