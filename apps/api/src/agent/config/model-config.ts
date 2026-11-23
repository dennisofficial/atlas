import {
  EEffort,
  EModelRole,
  EStalePolicy,
  parseRef,
  resolveModelChoice,
  type ModelChoice,
  type ModelRef,
  type ModelRole,
  type ResolvedModelChoice,
} from '@dltech/atlas-core'
import {
  accountCredentialOf,
  authProviderOf,
  chosenFor,
  parsedAccountsOf,
  reachableOf,
  type ActiveAccountRowLike,
  type ParsedAccount,
  type SealedAccountRowLike,
} from '@dltech/atlas-credentials'
import { capabilitiesOver, fallbackRefOf, readOf, SHIPPED_DEFAULT_REF } from '@dltech/atlas-models'

import type { ModelConfig } from './agent-host-config'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

export type ActiveAccountRow = ActiveAccountRowLike

export type AccountRow = SealedAccountRowLike

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
  const provider = authProviderOf(ref.providerId)
  const chosen =
    provider === undefined
      ? undefined
      : chosenFor({ provider, parsed: args.parsed, activeAccounts: args.activeAccounts })
  if (chosen === undefined) {
    return { configured: false, gap: `no ${ref.providerId} account`, unavailable: ref }
  }
  const credential = accountCredentialOf({
    row: chosen.row,
    unseal: (sealed) => args.cipher.decrypt(sealed),
  })
  if (credential === undefined) {
    return { configured: false, gap: `account ${chosen.row.id} has no secret` }
  }
  const base = {
    configured: true,
    ref,
    effort: args.choice.effort,
    fast: args.choice.fast,
    accountId: chosen.row.id,
  } as const
  if (credential.kind === 'api-key') {
    return { ...base, credential: { kind: 'api-key', apiKey: credential.apiKey } }
  }
  if (credential.connectionId === undefined) {
    return { configured: false, gap: 'oauth account has no cloud connection' }
  }
  return { ...base, credential: { kind: 'oauth', connectionId: credential.connectionId } }
}

export type ModelAccountsArgs = Omit<ModelSourceArgs, 'session'>

type ChoiceRequest = { role: ModelRole; stale: EStalePolicy; root?: ModelChoice | undefined }

const chooserOf = (args: ModelAccountsArgs) => {
  const parsed = parsedAccountsOf(args.accounts)
  const reachable = reachableOf({ parsed, activeAccounts: args.activeAccounts })
  const capabilitiesOf = capabilitiesOver(reachable)
  const read = readOf(args.settings)
  const fallback =
    fallbackRefOf({ parsed, activeAccounts: args.activeAccounts }) ?? SHIPPED_DEFAULT_REF
  const choose = (request: ChoiceRequest): ResolvedModelChoice =>
    resolveModelChoice({
      role: request.role,
      read,
      capabilitiesOf,
      fallback,
      stale: request.stale,
      ...(request.root === undefined ? {} : { root: request.root }),
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
  return { fallback, choose, resolvedOf }
}

export type TitlerModels = { titler: ResolvedRoleModel; fallback?: ResolvedRoleModel | undefined }

export const titlerModelsOf = (
  args: ModelAccountsArgs & { sessionRef?: ModelRef | undefined },
): TitlerModels => {
  const { choose, resolvedOf } = chooserOf(args)
  const titler = resolvedOf(choose({ role: EModelRole.Quick, stale: EStalePolicy.Follow }))
  if (args.sessionRef === undefined) return { titler }
  const root = { ref: args.sessionRef, effort: titler.choice.effort, fast: false }
  return {
    titler,
    fallback: resolvedOf(choose({ role: EModelRole.Main, stale: EStalePolicy.Keep, root })),
  }
}

export const modelSourceOf = (args: ModelSourceArgs): ModelSource => {
  const { fallback, choose, resolvedOf } = chooserOf(args)

  const mainChoice = choose({
    role: EModelRole.Main,
    stale: EStalePolicy.Keep,
    root: {
      ref: parseRef(args.session.ref) ?? fallback,
      effort: effortOf(args.session.effort) ?? DEFAULT_EFFORT,
      fast: args.session.fast,
    },
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
