import {
  accountSchema,
  accountSecretSchema,
  chooseAccount,
  EAccountChoice,
  EAuthKind,
  EAuthProvider,
  DEFAULT_EFFORT,
  EEffort,
  parseRef,
  toAccountId,
  type Account,
  type ModelRef,
} from '@dltech/atlas-core'
import { cardsForProvider } from '@dltech/atlas-models'

import type { ModelConfig } from './agent-host-config'
import type { SecretCipher } from './secret-cipher'

const SHIPPED_DEFAULT_REF: ModelRef = { providerId: 'anthropic', modelId: 'claude-haiku-4-5' }
const SETTING_VALUE_PREFIX = 'atlas-setting:v1:'
const FALLBACK_PROVIDERS = [
  EAuthProvider.Anthropic,
  EAuthProvider.OpenAI,
  EAuthProvider.OpenRouter,
  EAuthProvider.Gateway,
  EAuthProvider.Inference,
]

export const MODEL_SETTING_KEYS = {
  id: 'model.id',
  effort: 'model.effort',
  fast: 'model.fast',
} as const

export type ActiveAccountRow = { provider: string; accountId: string }

export type AccountRow = {
  id: string
  provider: string
  kind: string
  origin: string
  label: string
  status: string
  email: string | null
  subscription: string | null
  importedFrom: string | null
  sealedSecret: string
  createdAt: Date
  updatedAt: Date
}

const decodeSettingValue = (stored: string): unknown => {
  if (!stored.startsWith(SETTING_VALUE_PREFIX)) return stored
  try {
    return JSON.parse(stored.slice(SETTING_VALUE_PREFIX.length))
  } catch {
    return stored
  }
}

const accountOf = (row: AccountRow): Account | undefined => {
  const parsed = accountSchema.safeParse({
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    origin: row.origin,
    label: row.label,
    status: row.status,
    ...(row.email === null ? {} : { email: row.email }),
    ...(row.subscription === null ? {} : { subscription: row.subscription }),
    ...(row.importedFrom === null ? {} : { importedFrom: row.importedFrom }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
  return parsed.success ? parsed.data : undefined
}

type ParsedAccount = { account: Account; row: AccountRow }

const settingOf = (args: { settings: ReadonlyMap<string, string>; key: string }): unknown => {
  const stored = args.settings.get(args.key)
  return stored === undefined ? undefined : decodeSettingValue(stored)
}

const effortOf = (value: unknown): EEffort =>
  Object.values(EEffort).find((effort) => effort === value) ?? DEFAULT_EFFORT

const isProvider = (value: string): value is EAuthProvider =>
  Object.values(EAuthProvider).some((provider) => provider === value)

const chosenFor = (args: {
  provider: EAuthProvider
  parsed: readonly ParsedAccount[]
  activeAccounts: readonly ActiveAccountRow[]
}): ParsedAccount | undefined => {
  const active = args.activeAccounts.find((entry) => entry.provider === args.provider)
  const choice = chooseAccount({
    accounts: args.parsed.map((entry) => entry.account),
    provider: args.provider,
    ...(active === undefined ? {} : { preferred: toAccountId(active.accountId) }),
  })
  if (choice.type !== EAccountChoice.Chosen) return undefined
  return args.parsed.find((entry) => entry.account.id === choice.account.id)
}

const fallbackRefOf = (args: {
  parsed: readonly ParsedAccount[]
  activeAccounts: readonly ActiveAccountRow[]
}): ModelRef | undefined => {
  if (chosenFor({ ...args, provider: EAuthProvider.Anthropic }) !== undefined) {
    return SHIPPED_DEFAULT_REF
  }
  for (const provider of FALLBACK_PROVIDERS) {
    if (chosenFor({ ...args, provider }) === undefined) continue
    const card = cardsForProvider(provider)[0]
    if (card !== undefined) return card.ref
  }
  return undefined
}

export const modelConfigOf = (args: {
  cipher: SecretCipher
  accounts: readonly AccountRow[]
  activeAccounts: readonly ActiveAccountRow[]
  settings: ReadonlyMap<string, string>
}): ModelConfig => {
  const parsed = args.accounts.flatMap((row) => {
    const account = accountOf(row)
    return account === undefined ? [] : [{ account, row }]
  })
  const idSetting = settingOf({ settings: args.settings, key: MODEL_SETTING_KEYS.id })
  const named = typeof idSetting === 'string' ? parseRef(idSetting) : undefined
  const ref = named ?? fallbackRefOf({ parsed, activeAccounts: args.activeAccounts })
  if (ref === undefined) return { configured: false, gap: 'no model account' }
  if (!isProvider(ref.providerId)) {
    return { configured: false, gap: `no ${ref.providerId} account` }
  }
  const chosen = chosenFor({
    provider: ref.providerId,
    parsed,
    activeAccounts: args.activeAccounts,
  })
  if (chosen === undefined) return { configured: false, gap: `no ${ref.providerId} account` }
  const secret = accountSecretSchema.safeParse(
    JSON.parse(args.cipher.decrypt(chosen.row.sealedSecret)),
  )
  if (!secret.success) return { configured: false, gap: `account ${chosen.row.id} has no secret` }
  const base = {
    configured: true,
    ref,
    effort: effortOf(settingOf({ settings: args.settings, key: MODEL_SETTING_KEYS.effort })),
    fast: settingOf({ settings: args.settings, key: MODEL_SETTING_KEYS.fast }) === true,
    accountId: chosen.row.id,
  } as const
  if (secret.data.kind === EAuthKind.ApiKey) {
    return { ...base, credential: { kind: 'api-key', apiKey: secret.data.apiKey } }
  }
  const connectionId = secret.data.authority?.connectionId
  if (connectionId === undefined)
    return { configured: false, gap: 'oauth account has no cloud connection' }
  return { ...base, credential: { kind: 'oauth', connectionId } }
}
