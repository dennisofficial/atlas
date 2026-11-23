import {
  EAccountKind,
  type EProvider,
  type ProviderAccount,
  type ProviderInfo,
  type ProviderState,
} from '../fixtures/settings-providers'

const MASK_TAIL_LENGTH = 4
const TODAY_ADDED = 'Added Nov 23'
const UNKNOWN_PREFIX_MASK = '••••'

export function maskKey({ provider, key }: { provider: ProviderInfo; key: string }): string {
  const tail = key.slice(-MASK_TAIL_LENGTH)
  return provider.keyPrefix ? `${provider.keyPrefix}…${tail}` : `${UNKNOWN_PREFIX_MASK}${tail}`
}

export function selectAccount({
  state,
  provider,
  accountId,
}: {
  state: ProviderState
  provider: EProvider
  accountId: string
}): ProviderState {
  return { ...state, inUse: { ...state.inUse, [provider]: accountId } }
}

export function addAccount({
  state,
  provider,
  account,
  use,
}: {
  state: ProviderState
  provider: EProvider
  account: ProviderAccount
  use: boolean
}): ProviderState {
  const accounts = { ...state.accounts, [provider]: [...state.accounts[provider], account] }
  const firstAccount = state.inUse[provider] === null
  const inUse = use || firstAccount ? { ...state.inUse, [provider]: account.id } : state.inUse
  return { accounts, inUse }
}

export function newApiKey(args: {
  provider: ProviderInfo
  name: string
  key: string
}): ProviderAccount {
  return {
    id: `acc-${args.provider.id}-${args.key.slice(-MASK_TAIL_LENGTH)}-${Date.now()}`,
    kind: EAccountKind.ApiKey,
    name: args.name,
    masked: maskKey({ provider: args.provider, key: args.key }),
    added: TODAY_ADDED,
    usage: [],
  }
}

export function newPlanAccount(provider: ProviderInfo): ProviderAccount {
  return {
    id: `acc-${provider.id}-plan-${Date.now()}`,
    kind: EAccountKind.Plan,
    name: 'dennis+new@trycomp.ai',
    plan: 'Pro',
    added: 'Signed in Nov 23',
    usage: [],
  }
}

export function updateAccount({
  state,
  provider,
  accountId,
  change,
}: {
  state: ProviderState
  provider: EProvider
  accountId: string
  change: Partial<ProviderAccount>
}): ProviderState {
  const accounts = state.accounts[provider].map((account) =>
    account.id === accountId ? { ...account, ...change } : account,
  )
  return { ...state, accounts: { ...state.accounts, [provider]: accounts } }
}

export function removeAccount({
  state,
  provider,
  accountId,
}: {
  state: ProviderState
  provider: EProvider
  accountId: string
}): ProviderState {
  const remaining = state.accounts[provider].filter((account) => account.id !== accountId)
  const wasInUse = state.inUse[provider] === accountId
  const nextInUse = wasInUse ? (remaining[0]?.id ?? null) : state.inUse[provider]
  return {
    accounts: { ...state.accounts, [provider]: remaining },
    inUse: { ...state.inUse, [provider]: nextInUse },
  }
}
