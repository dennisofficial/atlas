import { ENoticeTone, NOTICE_WARN_MS, type NoticePort } from '@dltech/atlas-core'

import type { CloudSettingsStore } from '../cloud/cloud-settings-store'
import { CloudUserSettingsStore, localOnlySettingIds } from '../cloud/cloud-user-settings-store'
import { SecretsStoreProxy } from '../cloud/secrets-store-proxy'
import { registerDisposable } from '../container/disposal'
import type { DependencyContainer } from '../container/injection'
import { registerCloudBackedStores } from '../container/register-cloud-backed-stores'
import { CloudSettingsStoreToken, SecretsStoreToken } from '../container/tokens'
import type { SettingsService } from '../settings/service'

import type { SettingsBinding } from './settings-binding'

export const CLOUD_STATE_PULL_BUDGET_MS = 5_000

export type CloudStateBinding = {
  settings: SettingsBinding
  cloudBacked: boolean
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'unknown failure'

const warn = (args: { notice: NoticePort; key: string; text: string }): void =>
  args.notice.notify({
    key: args.key,
    tone: ENoticeTone.Warn,
    ttlMs: NOTICE_WARN_MS,
    text: args.text,
  })

async function warmSecrets(container: DependencyContainer): Promise<void> {
  const secrets = container.resolve(SecretsStoreToken)
  if (secrets instanceof SecretsStoreProxy) await secrets.warm()
}

async function pullWithinBudget(args: {
  container: DependencyContainer
  cloud: CloudSettingsStore
  notice: NoticePort
  budgetMs: number
}): Promise<void> {
  const { notice } = args
  const failed = (what: string) => (error: unknown) =>
    warn({
      notice,
      key: `cloud:state-pull:${what}`,
      text: `Atlas Cloud ${what} did not load (${messageOf(error)}) — continuing without them until the next refresh.`,
    })

  const pulls = Promise.all([
    warmSecrets(args.container).catch(failed('secrets')),
    args.cloud.refresh().catch(failed('settings')),
  ]).then(() => 'done' as const)

  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), args.budgetMs)
  })

  const outcome = await Promise.race([pulls, late])
  clearTimeout(timer)
  if (outcome === 'late') {
    warn({
      notice,
      key: 'cloud:state-pull:late',
      text: 'Atlas Cloud was slow to answer — settings and secrets fill in when it does.',
    })
  }
}

function swapUserLayer(args: {
  container: DependencyContainer
  settings: SettingsBinding
  cloud: CloudSettingsStore
  notice: NoticePort
}): SettingsBinding {
  const { settings, cloud, notice, container } = args
  if (settings.withUserStore === undefined) return settings

  const original = settings.service
  const localOnly = localOnlySettingIds(original.definitions)
  let service: SettingsService | undefined
  let store: CloudUserSettingsStore | undefined

  const bound = settings.withUserStore((local) => {
    store = new CloudUserSettingsStore({
      local,
      cloud,
      localOnly,
      notice,
      onChange: () => service?.reload(),
    })
    return store
  })

  service = bound.service
  original.close()
  registerDisposable({ container, close: async () => store?.close() })
  return bound
}

export async function bindCloudState(args: {
  enabled: boolean
  container: DependencyContainer
  settings: SettingsBinding
  clientVersion: string
  notice: NoticePort
  budgetMs?: number
}): Promise<CloudStateBinding> {
  if (!args.enabled) return { settings: args.settings, cloudBacked: false }

  const { container, notice } = args
  registerCloudBackedStores({ container, clientVersion: args.clientVersion })

  const cloud = container.resolve(CloudSettingsStoreToken)
  await pullWithinBudget({
    container,
    cloud,
    notice,
    budgetMs: args.budgetMs ?? CLOUD_STATE_PULL_BUDGET_MS,
  })

  return {
    settings: swapUserLayer({ container, settings: args.settings, cloud, notice }),
    cloudBacked: true,
  }
}
