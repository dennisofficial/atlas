import {
  accountSchema,
  accountSecretSchema,
  chooseAccount,
  EAccountChoice,
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type Account,
} from '@dltech/atlas-core'

export type ActiveAccountRowLike = { provider: string; accountId: string }

export type AccountRowLike = {
  id: string
  provider: string
  kind: string
  origin: string
  label: string
  status: string
  email: string | null
  subscription: string | null
  importedFrom: string | null
  createdAt: Date
  updatedAt: Date
}

export type SealedAccountRowLike = AccountRowLike & { sealedSecret: string }

export type ParsedAccount<Row extends AccountRowLike> = { account: Account; row: Row }

export type ProviderCredential =
  | { kind: 'api-key'; accountId: string; apiKey: string }
  | { kind: 'plan'; accountId: string; connectionId?: string | undefined }

const accountOfRow = (row: AccountRowLike): Account | undefined => {
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

export const parsedAccountsOf = <Row extends AccountRowLike>(
  rows: readonly Row[],
): readonly ParsedAccount<Row>[] =>
  rows.flatMap((row) => {
    const account = accountOfRow(row)
    return account === undefined ? [] : [{ account, row }]
  })

export const authProviderOf = (value: string): EAuthProvider | undefined =>
  Object.values(EAuthProvider).find((provider) => provider === value)

export const chosenFor = <Row extends AccountRowLike>(args: {
  provider: EAuthProvider
  parsed: readonly ParsedAccount<Row>[]
  activeAccounts: readonly ActiveAccountRowLike[]
}): ParsedAccount<Row> | undefined => {
  const active = args.activeAccounts.find((entry) => entry.provider === args.provider)
  const preferred = active?.accountId
  const choice = chooseAccount({
    accounts: args.parsed.map((entry) => entry.account),
    provider: args.provider,
    ...(preferred === undefined ? {} : { preferred: toAccountId(preferred) }),
  })
  if (choice.type !== EAccountChoice.Chosen) return undefined
  return args.parsed.find((entry) => entry.account.id === choice.account.id)
}

export const reachableOf =
  (args: {
    parsed: readonly ParsedAccount<AccountRowLike>[]
    activeAccounts: readonly ActiveAccountRowLike[]
  }): ((providerId: string) => boolean) =>
  (providerId) => {
    const provider = authProviderOf(providerId)
    return provider !== undefined && chosenFor({ provider, ...args }) !== undefined
  }

export const accountCredentialOf = (args: {
  row: SealedAccountRowLike
  unseal: (sealedSecret: string) => string
}): ProviderCredential | undefined => {
  const secret = accountSecretSchema.safeParse(JSON.parse(args.unseal(args.row.sealedSecret)))
  if (!secret.success) return undefined
  if (secret.data.kind === EAuthKind.ApiKey) {
    return { kind: 'api-key', accountId: args.row.id, apiKey: secret.data.apiKey }
  }
  return {
    kind: 'plan',
    accountId: args.row.id,
    connectionId: secret.data.authority?.connectionId,
  }
}

const apiKeyAccountsOf = <Row extends AccountRowLike>(
  parsed: readonly ParsedAccount<Row>[],
): readonly ParsedAccount<Row>[] =>
  parsed.filter((entry) => entry.account.kind === EAuthKind.ApiKey)

export const classifierCredentialOf = <Row extends SealedAccountRowLike>(args: {
  provider: EAuthProvider
  parsed: readonly ParsedAccount<Row>[]
  activeAccounts: readonly ActiveAccountRowLike[]
  unseal: (sealedSecret: string) => string
}): ProviderCredential | null =>
  providerCredentialOf({ ...args, parsed: apiKeyAccountsOf(args.parsed) }) ??
  providerCredentialOf(args)

export const providerCredentialOf = <Row extends SealedAccountRowLike>(args: {
  provider: EAuthProvider
  parsed: readonly ParsedAccount<Row>[]
  activeAccounts: readonly ActiveAccountRowLike[]
  unseal: (sealedSecret: string) => string
}): ProviderCredential | null => {
  const chosen = chosenFor(args)
  if (chosen === undefined) return null
  return accountCredentialOf({ row: chosen.row, unseal: args.unseal }) ?? null
}
