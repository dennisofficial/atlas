import {
  accountSchema,
  accountSecretSchema,
  capabilitiesFromCatalog,
  chooseAccount,
  EAccountChoice,
  EAuthKind,
  EAuthProvider,
  EEffort,
  EModelRole,
  EStalePolicy,
  parseRef,
  resolveModelChoice,
  toAccountId,
  type Account,
  type CapabilitiesOf,
  type ModelCapabilities,
  type ModelChoice,
  type ModelRef,
  type ModelRole,
  type ResolvedModelChoice,
} from '@dltech/atlas-core'
import { cardsForProvider, generatedCatalogue } from '@dltech/atlas-models'

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

export type SettingReader = (settingId: string) => string | boolean | undefined

const decodeSettingValue = (stored: string): unknown => {
  if (!stored.startsWith(SETTING_VALUE_PREFIX)) return stored
  try {
    return JSON.parse(stored.slice(SETTING_VALUE_PREFIX.length))
  } catch {
    return stored
  }
}

export const readOf =
  (settings: ReadonlyMap<string, string>): SettingReader =>
  (settingId) => {
    const stored = settings.get(settingId)
    if (stored === undefined) return undefined
    const decoded = decodeSettingValue(stored)
    return typeof decoded === 'string' || typeof decoded === 'boolean' ? decoded : undefined
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

const parsedAccountsOf = (rows: readonly AccountRow[]): readonly ParsedAccount[] =>
  rows.flatMap((row) => {
    const account = accountOf(row)
    return account === undefined ? [] : [{ account, row }]
  })

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

const reachableOf =
  (args: {
    parsed: readonly ParsedAccount[]
    activeAccounts: readonly ActiveAccountRow[]
  }): ((providerId: string) => boolean) =>
  (providerId) =>
    isProvider(providerId) && chosenFor({ provider: providerId, ...args }) !== undefined

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

/** The model the thread itself runs, as the API recorded it when it was created or changed. */
export type ThreadModelChoice = {
  ref: string
  effort?: string | undefined
  fast?: boolean | undefined
}

export type ResolvedRoleModel = { choice: ResolvedModelChoice; config: ModelConfig }

export type ModelSource = {
  main: ResolvedRoleModel
  resolve(args: { role: ModelRole; root?: ModelChoice | undefined }): ResolvedRoleModel
}

export type ModelSourceArgs = {
  cipher: SecretCipher
  accounts: readonly AccountRow[]
  activeAccounts: readonly ActiveAccountRow[]
  settings: ReadonlyMap<string, string>
  thread?: ThreadModelChoice | undefined
}

const UNCATALOGUED: ModelCapabilities = { efforts: [], fast: false, runnable: true }

const capabilitiesOver = (reachable: (providerId: string) => boolean): CapabilitiesOf => {
  const fromCatalog = capabilitiesFromCatalog({ catalog: generatedCatalogue(), reachable })
  return (ref) => fromCatalog(ref) ?? (reachable(ref.providerId) ? UNCATALOGUED : undefined)
}

const effortOf = (value: unknown): EEffort | undefined =>
  Object.values(EEffort).find((effort) => effort === value)

const configuredWith = (args: {
  cipher: SecretCipher
  parsed: readonly ParsedAccount[]
  activeAccounts: readonly ActiveAccountRow[]
  choice: ResolvedModelChoice
}): ModelConfig => {
  const { ref } = args.choice
  if (args.parsed.length === 0) return { configured: false, gap: 'no model account' }
  if (!isProvider(ref.providerId)) {
    return { configured: false, gap: `no ${ref.providerId} account` }
  }
  const chosen = chosenFor({
    provider: ref.providerId,
    parsed: args.parsed,
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
    effort: args.choice.effort,
    fast: args.choice.fast,
    accountId: chosen.row.id,
  } as const
  if (secret.data.kind === EAuthKind.ApiKey) {
    return { ...base, credential: { kind: 'api-key', apiKey: secret.data.apiKey } }
  }
  const connectionId = secret.data.authority?.connectionId
  if (connectionId === undefined) {
    return { configured: false, gap: 'oauth account has no cloud connection' }
  }
  return { ...base, credential: { kind: 'oauth', connectionId } }
}

export const modelSourceOf = (args: ModelSourceArgs): ModelSource => {
  const parsed = parsedAccountsOf(args.accounts)
  const reachable = reachableOf({ parsed, activeAccounts: args.activeAccounts })
  const capabilitiesOf = capabilitiesOver(reachable)
  const read = readOf(args.settings)
  const fallback =
    fallbackRefOf({ parsed, activeAccounts: args.activeAccounts }) ?? SHIPPED_DEFAULT_REF

  const choose = (request: {
    role: ModelRole
    stale: EStalePolicy
    root?: ModelChoice | undefined
  }): ResolvedModelChoice =>
    resolveModelChoice({
      role: request.role,
      read,
      capabilitiesOf,
      fallback,
      stale: request.stale,
      ...(request.root === undefined ? {} : { root: request.root }),
    })

  const fromSettingsMain = choose({ role: EModelRole.Main, stale: EStalePolicy.Keep })
  const named = args.thread === undefined ? undefined : parseRef(args.thread.ref)
  const threadRef = named !== undefined && reachable(named.providerId) ? named : undefined
  const root: ModelChoice | undefined =
    threadRef === undefined || args.thread === undefined
      ? undefined
      : {
          ref: threadRef,
          effort: effortOf(args.thread.effort) ?? fromSettingsMain.effort,
          fast: args.thread.fast ?? fromSettingsMain.fast,
        }
  const mainChoice =
    root === undefined
      ? fromSettingsMain
      : choose({ role: EModelRole.Main, stale: EStalePolicy.Keep, root })

  const resolvedOf = (choice: ResolvedModelChoice): ResolvedRoleModel => ({
    choice,
    config: configuredWith({
      cipher: args.cipher,
      parsed,
      activeAccounts: args.activeAccounts,
      choice,
    }),
  })
  const main = resolvedOf(mainChoice)

  return {
    main,
    resolve: ({ role, root: spawner }) =>
      role === EModelRole.Main
        ? main
        : resolvedOf(choose({ role, stale: EStalePolicy.Follow, root: spawner ?? main.choice })),
  }
}

export const modelConfigOf = (args: ModelSourceArgs): ModelConfig => modelSourceOf(args).main.config
