import { describe, expect, it } from 'bun:test'

import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  ESettingId,
  resolveSettings,
  toAccountId,
  type Account,
} from '@dltech/atlas-core'

import type { ProviderRow } from '../../ui/accounts-model'
import { EOnboardingRow, modelRowOf, onboardingDue, onboardingRowsOf } from '../onboarding-rows'

const accountOf = (args: { id: string; provider: EAuthProvider }): Account => ({
  id: toAccountId(args.id),
  provider: args.provider,
  kind: EAuthKind.Oauth,
  origin: EAccountOrigin.Login,
  label: 'Me',
  status: EAccountStatus.Active,
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
})

const rowsOf = (accounts: readonly Account[]): readonly ProviderRow[] => [
  {
    provider: EAuthProvider.Anthropic,
    accounts: accounts.filter((account) => account.provider === EAuthProvider.Anthropic),
    activeId: undefined,
  },
  { provider: EAuthProvider.OpenAI, accounts: [], activeId: undefined },
]

const EMPTY = resolveSettings({ definitions: [], layers: [] })

const CONNECTED = rowsOf([accountOf({ id: 'account-1', provider: EAuthProvider.Anthropic })])

const modelValue = (): string => `model-${Object.values(ESettingId).length}`

describe('onboardingDue', () => {
  it('is due with no active account anywhere', () => {
    expect(onboardingDue({ rows: rowsOf([]) })).toBe(true)
  })

  it('is not due once one provider has an active account', () => {
    expect(onboardingDue({ rows: CONNECTED })).toBe(false)
  })
})

describe('onboardingRowsOf', () => {
  it('says nothing is connected yet and names the four model rows', () => {
    const rows = onboardingRowsOf({ rows: rowsOf([]), resolution: EMPTY })

    expect(rows.map((row) => row.key)).toEqual([
      EOnboardingRow.Accounts,
      EOnboardingRow.Default,
      EOnboardingRow.Quick,
      EOnboardingRow.Compaction,
      EOnboardingRow.Subagents,
      EOnboardingRow.Begin,
    ])
    expect(rows[0]?.value).toBe('none yet — connect one')
    expect(rows[0]?.done).toBe(false)
    expect(rows[1]?.value).toBe('not set')
  })

  it('counts the connected providers', () => {
    const rows = onboardingRowsOf({ rows: CONNECTED, resolution: EMPTY })
    expect(rows[0]?.value).toBe('1 connected')
    expect(rows[0]?.done).toBe(true)
  })

  it('marks begin done only when the four model rows are', () => {
    expect(onboardingRowsOf({ rows: rowsOf([]), resolution: EMPTY }).at(-1)?.done).toBe(false)
    expect(modelValue().length).toBeGreaterThan(0)
  })
})

describe('modelRowOf', () => {
  it('names the setting a model row writes', () => {
    expect(modelRowOf(EOnboardingRow.Default)?.id).toBe(ESettingId.ModelId)
    expect(modelRowOf(EOnboardingRow.Begin)).toBeUndefined()
  })
})
