import {
  AccountStorePort,
  ClockPort,
  CredentialPort,
  EAuthProvider,
  type Account,
  type AccountId,
  type AccountSecret,
} from '@dltech/atlas-core'

import { AccountStoreProxy } from '../cloud/account-store-proxy'
import { CloudService } from '../cloud/cloud-service'
import { SecretsStoreProxy } from '../cloud/secrets-store-proxy'
import type { CloudSession } from '../cloud/cloud-session'
import { registeredPortToken, type DependencyContainer } from '../container/injection'
import {
  CloudSessionStoreToken,
  LocalAccountStoreToken,
  LocalSecretsStoreToken,
  SecretsStoreToken,
  UserSettingsStoreToken,
} from '../container/tokens'
import { AccountsService } from '../credentials/accounts-service'
import { CloudManagedCredentialPort } from '../credentials/cloud-managed-credential-port'
import { syncEnvironmentAccounts } from '../credentials/environment-accounts'
import { builtinOauthClients } from '../credentials/oauth/refresh-client'
import { AnthropicUsageClient } from '../usage/anthropic-usage-client'
import { CodexUsageClient } from '../usage/codex-usage-client'
import { createAccountUsageService, type AccountUsageService } from '../usage/account-usage-service'
import { RoutedAccountUsage } from '../usage/routed-account-usage'

export async function bindAccounts(args: {
  container: DependencyContainer
  env: Record<string, string | undefined>
  cloudUrl: string | undefined
  clientVersion: string
  /** False in serve, where the vault was transferred with the sandbox and host sources must not touch it. */
  reconcileHostSources?: boolean
  cloudBacked?: boolean
}): Promise<{
  credentials: CredentialPort
  accounts: AccountsService
  cloud: CloudService
  usage: AccountUsageService
}> {
  const { container } = args

  const credentials = container.resolve(registeredPortToken(CredentialPort))
  const accountStore = container.resolve(registeredPortToken(AccountStorePort))

  const cloud = new CloudService({
    sessions: container.resolve(CloudSessionStoreToken),
    localAccounts: container.resolve(LocalAccountStoreToken),
    accounts: accountStore,
    localSecrets: container.resolve(LocalSecretsStoreToken),
    ...(container.isRegistered(UserSettingsStoreToken, true)
      ? { localSettings: container.resolve(UserSettingsStoreToken) }
      : {}),
    defaultUrl: args.cloudUrl ?? 'http://localhost:3400',
    clientVersion: args.clientVersion,
    uploadOnSignIn: args.cloudBacked === true && args.reconcileHostSources !== false,
    onUploaded: async () => {
      if (accountStore instanceof AccountStoreProxy) accountStore.invalidateCloudCache()
      const secrets = container.resolve(SecretsStoreToken)
      if (secrets instanceof SecretsStoreProxy) await secrets.warm()
    },
    ...(credentials instanceof CloudManagedCredentialPort
      ? {
          handoffOauth: (session: CloudSession, accountIds?: readonly AccountId[]) =>
            credentials.handoffAll(session, accountIds),
        }
      : {}),
  })

  if (args.reconcileHostSources !== false) {
    await syncEnvironmentAccounts({
      accounts:
        args.cloudBacked === true ? container.resolve(LocalAccountStoreToken) : accountStore,
      env: args.env,
    })
  }

  const accounts = new AccountsService({
    accounts: accountStore,
    clients: builtinOauthClients({
      clock: container.resolve(registeredPortToken(ClockPort)),
    }),
    ...(credentials instanceof CloudManagedCredentialPort
      ? {
          onOauthLogin: (account: Account) =>
            credentials
              .read({ provider: account.provider, accountId: account.id })
              .then(() => undefined),
          prepareOauthReplacement: (replacement: { accountId: AccountId; secret: AccountSecret }) =>
            credentials.prepareReplacement(replacement),
        }
      : {}),
  })
  const usage = createAccountUsageService({
    usage: new RoutedAccountUsage({
      accounts: accountStore,
      clients: {
        [EAuthProvider.Anthropic]: new AnthropicUsageClient({ credentials }),
        [EAuthProvider.OpenAI]: new CodexUsageClient({ credentials }),
      },
    }),
  })

  return { credentials, accounts, cloud, usage }
}
