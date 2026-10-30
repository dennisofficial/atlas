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
import { registeredPortToken, type DependencyContainer } from '../container/injection'
import { SecretsStoreToken } from '../container/tokens'
import { migrateDecisionsSettings } from '../settings/migrate-decisions'
import type { AccountsService } from '../credentials/accounts-service'
import { CloudManagedCredentialPort } from '../credentials/cloud-managed-credential-port'
import type { AccountUsageService } from '../usage/account-usage-service'

import { bindAccounts } from './account-bindings'
import { bindSettingsPolicy } from './policy-bindings'
import type { SettingsBinding } from './settings-binding'

export const STARTUP_MIGRATION_BUDGET_MS = 5_000

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const warnOf =
  (args: { notice: NoticePort; key: string }) =>
  (text: string): void =>
    args.notice.notify({
      key: args.key,
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text,
    })

async function migrateAtStartup(args: { cloud: CloudService; notice: NoticePort }): Promise<void> {
  const warn = warnOf({ notice: args.notice, key: 'cloud:local-migration' })
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), STARTUP_MIGRATION_BUDGET_MS)
  })
  const work = args.cloud.migrateLocal().then(
    () => 'done' as const,
    (error: unknown) => {
      warn(
        `This machine's accounts and secrets have not moved to Atlas Cloud yet (${messageOf(error)}). They keep working here; Atlas retries on the next start.`,
      )
      return 'done' as const
    },
  )
  await Promise.race([work, late])
  clearTimeout(timer)
}

async function bootAccountList(args: {
  accounts: AccountStorePort
  notice: NoticePort
}): Promise<readonly Account[]> {
  try {
    return await args.accounts.list()
  } catch (error) {
    warnOf({ notice: args.notice, key: 'cloud:accounts-unavailable' })(
      `Atlas Cloud accounts did not load (${messageOf(error)}). Model access fills in when the cloud answers.`,
    )
    return []
  }
}

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
  cloudBacked?: boolean
  env: Record<string, string | undefined>
  clientVersion: string
  reconcileHostSources: boolean
  workspace: WorkspaceIdentity
  anchor: string
  launchValue: (id: ESettingId) => string | undefined
  notice: NoticePort
}): Promise<CredentialsBinding> {
  const { container, notice } = args

  const accountStore = container.resolve(registeredPortToken(AccountStorePort))
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
    ...(args.cloudBacked === undefined ? {} : { cloudBacked: args.cloudBacked }),
  })

  if (args.cloudBacked === true && args.reconcileHostSources && cloud.session() !== null) {
    await migrateAtStartup({ cloud, notice })
  }

  const session = cloud.session()
  if (
    args.reconcileHostSources &&
    session !== null &&
    credentials instanceof CloudManagedCredentialPort
  ) {
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
  migrateDecisionsSettings({ settings: args.settings.service, secrets })

  await bindSettingsPolicy({
    container,
    settings: args.settings.service,
    secrets,
    workspace: args.workspace,
    credentials,
    cwd: args.anchor,
  })

  const accountList = await bootAccountList({ accounts: accountStore, notice })
  if (args.cloudBacked !== true && accountList.length === 0 && cloud.session() !== null) {
    notice.notify({
      key: 'cloud:legacy-accounts',
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text: LEGACY_ACCOUNTS_NOTICE,
    })
  }

  return { credentials, accounts, cloud, usage, secrets, accountList }
}
