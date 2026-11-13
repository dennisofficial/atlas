import type { SessionModelChoice } from '@dltech/atlas-protocol'
import type { ModelOption } from '@dltech/atlas-ui/ai/model-selector'

import type { Account } from '@/features/settings/data/personal/accounts-api'
import {
  UNSET_SELECTION,
  effortOfName,
  type ModelSelection,
} from '@/features/threads/data/model-selection'

export type { SessionModelChoice }

export type SessionModelArgs = {
  model: string
  effort?: string
  fast?: boolean
  accountId?: string
}

const ACCOUNT_SEPARATOR = '#'
const EXPIRED = 'expired'
const PROVIDER_SEPARATOR = '/'

export const providerIdOfRef = (ref: string): string => {
  const at = ref.indexOf(PROVIDER_SEPARATOR)
  return at < 0 ? ref : ref.slice(0, at)
}

export const optionIdOfChoice = (choice: {
  ref: string
  accountId?: string | undefined
}): string =>
  choice.accountId === undefined
    ? choice.ref
    : `${choice.ref}${ACCOUNT_SEPARATOR}${choice.accountId}`

export function choiceOfOptionId(id: string): {
  ref: string
  accountId?: string
} {
  const at = id.indexOf(ACCOUNT_SEPARATOR)
  if (at < 0) return { ref: id }
  return { ref: id.slice(0, at), accountId: id.slice(at + 1) }
}

export const sessionModelOf = (
  row: { model?: SessionModelChoice | null | undefined } | null | undefined,
): SessionModelChoice | null => row?.model ?? null

const usableAccountsByProvider = (
  accounts: readonly Account[],
): ReadonlyMap<string, readonly Account[]> => {
  const byProvider = new Map<string, Account[]>()
  for (const account of accounts) {
    if (account.status === EXPIRED) continue
    const held = byProvider.get(account.provider) ?? []
    held.push(account)
    byProvider.set(account.provider, held)
  }
  return byProvider
}

const optionsOfModel = (args: {
  model: ModelOption
  accounts: readonly Account[]
}): ModelOption[] => {
  const { model, accounts } = args
  if (accounts.length < 2) return [model]
  return accounts.map((account) => ({
    ...model,
    id: optionIdOfChoice({ ref: model.id, accountId: account.id }),
    label: `${model.label} · ${account.label}`,
  }))
}

const optionOfChoice = (args: {
  choice: SessionModelChoice
  base: ModelOption | undefined
}): ModelOption => {
  const id = optionIdOfChoice(args.choice)
  return args.base === undefined ? { id, label: args.choice.ref } : { ...args.base, id }
}

export function accountModelOptionsOf(args: {
  models: readonly ModelOption[]
  accounts: readonly Account[]
  current?: SessionModelChoice | null | undefined
}): ModelOption[] {
  const byProvider = usableAccountsByProvider(args.accounts)
  const offered = args.models.flatMap((model) =>
    optionsOfModel({
      model,
      accounts: byProvider.get(providerIdOfRef(model.id)) ?? [],
    }),
  )
  const { current } = args
  if (current === undefined || current === null) return offered
  if (offered.some((option) => option.id === optionIdOfChoice(current))) return offered
  return [
    ...offered,
    optionOfChoice({
      choice: current,
      base: args.models.find((model) => model.id === current.ref),
    }),
  ]
}

export const selectionOfChoice = (
  choice: SessionModelChoice | null | undefined,
): ModelSelection => {
  if (choice === undefined || choice === null) return UNSET_SELECTION
  return {
    id: optionIdOfChoice(choice),
    effort: effortOfName(choice.effort),
    fast: choice.fast === true,
  }
}

export const plainSelectionOf = (selection: ModelSelection): ModelSelection => ({
  ...selection,
  id: choiceOfOptionId(selection.id).ref,
})

export function modelSetArgsOf(selection: ModelSelection): SessionModelArgs {
  const { ref, accountId } = choiceOfOptionId(selection.id)
  return {
    model: ref,
    effort: selection.effort,
    ...(selection.fast ? { fast: true } : {}),
    ...(accountId === undefined ? {} : { accountId }),
  }
}

export function sessionCreateFieldsOf(selection: ModelSelection): {
  model?: string
  effort?: string
  fast?: boolean
  accountId?: string
} {
  if (selection.id === UNSET_SELECTION.id) return {}
  return modelSetArgsOf(selection)
}
