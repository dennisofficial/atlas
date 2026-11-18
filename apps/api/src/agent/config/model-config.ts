import {
  accountSecretSchema,
  EAuthKind,
  EAuthProvider,
  EEffort,
  EModelRole,
  EStalePolicy,
  parseRef,
  resolveModelChoice,
  type ModelChoice,
  type ModelRole,
  type ResolvedModelChoice,
} from '@dltech/atlas-core'
import {
  capabilitiesOver,
  chosenFor,
  fallbackRefOf,
  parsedAccountsOf,
  readOf,
  reachableOf,
  SHIPPED_DEFAULT_REF,
  type AccountRowLike,
  type ActiveAccountRowLike,
  type ParsedAccount,
} from '@dltech/atlas-models'

import type { ModelConfig } from './agent-host-config'
import type { SecretCipher } from './secret-cipher'

export type ActiveAccountRow = ActiveAccountRowLike

export type AccountRow = AccountRowLike & { sealedSecret: string }

export type SessionModelRow = { ref: string; effort: string; fast: boolean }

export type ResolvedRoleModel = { choice: ResolvedModelChoice; config: ModelConfig }

export type ModelSource = {
  main: ResolvedRoleModel
  resolve(args: { role: ModelRole; root?: ModelChoice | undefined }): ResolvedRoleModel
  pinned(choice: ModelChoice): ResolvedRoleModel
}

export type ModelSourceArgs = {
  cipher: SecretCipher
  accounts: readonly AccountRow[]
  activeAccounts: readonly ActiveAccountRow[]
  settings: ReadonlyMap<string, string>
  session: SessionModelRow
}

const DEFAULT_EFFORT = EEffort.Medium

const providerOf = (value: string): EAuthProvider | undefined =>
  Object.values(EAuthProvider).find((provider) => provider === value)

const effortOf = (value: unknown): EEffort | undefined =>
  Object.values(EEffort).find((effort) => effort === value)

const configuredWith = (args: {
  cipher: SecretCipher
  parsed: readonly ParsedAccount<AccountRow>[]
  activeAccounts: readonly ActiveAccountRow[]
  choice: ResolvedModelChoice
}): ModelConfig => {
  const { ref } = args.choice
  if (args.parsed.length === 0) return { configured: false, gap: 'no model account' }
  const provider = providerOf(ref.providerId)
  const chosen =
    provider === undefined
      ? undefined
      : chosenFor({ provider, parsed: args.parsed, activeAccounts: args.activeAccounts })
  if (chosen === undefined) {
    return { configured: false, gap: `no ${ref.providerId} account`, unavailable: ref }
  }
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

  const mainChoice = choose({
    role: EModelRole.Main,
    stale: EStalePolicy.Keep,
    root: {
      ref: parseRef(args.session.ref) ?? fallback,
      effort: effortOf(args.session.effort) ?? DEFAULT_EFFORT,
      fast: args.session.fast,
    },
  })

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
    pinned: (choice) =>
      resolvedOf(choose({ role: EModelRole.Main, stale: EStalePolicy.Keep, root: choice })),
  }
}

export const modelConfigOf = (args: ModelSourceArgs): ModelConfig => modelSourceOf(args).main.config
