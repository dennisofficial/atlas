import {
  AccountStorePort,
  ClockPort,
  CredentialPort,
  type Account,
  type AccountId,
  type AccountSecret,
} from '@dltech/atlas-core'

import { CloudService } from '../cloud/cloud-service'
import type { CloudSession } from '../cloud/cloud-session'
import { portToken, type DependencyContainer } from '../container/injection'
import {
  CloudSessionStoreToken,
  LocalAccountStoreToken,
  LocalSecretsStoreToken,
  UserSettingsStoreToken,
} from '../container/tokens'
import { AccountsService } from '../credentials/accounts-service'
import { CloudManagedCredentialPort } from '../credentials/cloud-managed-credential-port'
import { syncEnvironmentAccounts } from '../credentials/environment-accounts'
import { builtinOauthClients } from '../credentials/oauth/refresh-client'
import { AnthropicUsageClient } from '../usage/anthropic-usage-client'
import { createAccountUsageService, type AccountUsageService } from '../usage/account-usage-service'

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
    ...(credentials instanceof CloudManagedCredentialPort
      ? { handoffOauth: (session: CloudSession, accountIds?: readonly AccountId[]) => credentials.handoffAll(session, accountIds) }
      : {}),
  })

  if (args.reconcileHostSources !== false) {
    await syncEnvironmentAccounts({ accounts: accountStore, env: args.env })
  }

  const accounts = new AccountsService({
    accounts: accountStore,
    clients: builtinOauthClients({ clock: container.resolve(portToken(ClockPort)) }),
    ...(credentials instanceof CloudManagedCredentialPort ? {
      onOauthLogin: (account: Account) =>
        credentials.read({ provider: account.provider, accountId: account.id }).then(() => undefined),
      prepareOauthReplacement: (replacement: { accountId: AccountId; secret: AccountSecret }) =>
        credentials.prepareReplacement(replacement),
    } : {}),
  })
  const usage = createAccountUsageService({ usage: new AnthropicUsageClient({ credentials }) })

  return { credentials, accounts, cloud, usage }
}
