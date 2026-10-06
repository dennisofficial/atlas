import {
  AccountStorePort,
  ENoticeTone,
  ESettingId,
  NOTICE_WARN_MS,
  type Account,
  type CredentialPort,
  type NoticePort,
  type SecretsPort,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import type { CloudService } from '../cloud/cloud-service'
import { registerDisposable } from '../container/disposal'
import { portToken, type DependencyContainer } from '../container/injection'
import { SecretsStoreToken } from '../container/tokens'
import type { AccountsService } from '../credentials/accounts-service'
import { CloudManagedCredentialPort } from '../credentials/cloud-managed-credential-port'
import type { AccountUsageService } from '../usage/account-usage-service'

import { bindAccounts } from './account-bindings'
import { bindSettingsPolicy } from './policy-bindings'
import type { SettingsBinding } from './settings-binding'

const LEGACY_ACCOUNTS_NOTICE =
  'Atlas found no local accounts, but a cloud sign-in may still hold them. Pull them down with a cloud download from settings; Atlas never fetches them on its own.'

export type CredentialsBinding = {
  credentials: CredentialPort
  accounts: AccountsService
  cloud: CloudService
  usage: AccountUsageService
  secrets: SecretsPort
  accountList: readonly Account[]
}

export async function bindCredentials(args: {
  container: DependencyContainer
  settings: SettingsBinding
  env: Record<string, string | undefined>
  clientVersion: string
  reconcileHostSources: boolean
  workspace: WorkspaceIdentity
  anchor: string
  launchValue: (id: ESettingId) => string | undefined
  notice: NoticePort
}): Promise<CredentialsBinding> {
  const { container, notice } = args

  const accountStore = container.resolve(portToken(AccountStorePort))
  args.settings.bindTo(container)
  registerDisposable({
    container,
    close: async () => {
      args.settings.service.close()
    },
  })
  const { credentials, accounts, cloud, usage } = await bindAccounts({
    container,
    env: args.env,
    cloudUrl: args.launchValue(ESettingId.CloudUrl),
    clientVersion: args.clientVersion,
    reconcileHostSources: args.reconcileHostSources,
  })

  const session = cloud.session()
  if (args.reconcileHostSources && session !== null && credentials instanceof CloudManagedCredentialPort) {
    void credentials.handoffAll(session).catch((error: unknown) => {
      notice.notify({
        key: 'cloud:oauth-handoff',
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
        text: `Signed in to Atlas Cloud; OAuth handoff is pending. ${error instanceof Error ? error.message : 'Retry sign-in.'}`,
      })
    })
  }

  const secrets = container.resolve(SecretsStoreToken)

  await bindSettingsPolicy({
    container,
    settings: args.settings.service,
    workspace: args.workspace,
    credentials,
    cwd: args.anchor,
  })

  const accountList = await accountStore.list()
  if (accountList.length === 0 && cloud.session() !== null) {
    notice.notify({
      key: 'cloud:legacy-accounts',
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text: LEGACY_ACCOUNTS_NOTICE,
    })
  }

  return { credentials, accounts, cloud, usage, secrets, accountList }
}
