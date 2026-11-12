import { describe, expect, it } from 'bun:test'

import type { ModelOption } from '@dltech/atlas-ui/ai/model-selector'

import type { Account } from '@/features/settings/data/personal/accounts-api'
import { EEffort } from '@dltech/atlas-ui/ai/model-selector'

import {
  accountModelOptionsOf,
  choiceOfOptionId,
  modelSetArgsOf,
  optionIdOfChoice,
  plainSelectionOf,
  providerIdOfRef,
  selectionOfChoice,
  sessionCreateFieldsOf,
  sessionModelOf,
} from '../session-model'

const accountOf = (args: Partial<Account> & { id: string; label: string }): Account => ({
  provider: 'anthropic',
  kind: 'oauth',
  status: 'active',
  createdAt: '2026-11-01T00:00:00.000Z',
  ...args,
})

const personal = accountOf({ id: 'acc_personal', label: 'dennislysenko@hotmail.com' })
const work = accountOf({ id: 'acc_work', label: 'dennis@trycomp.ai' })

const opus: ModelOption = {
  id: 'anthropic/claude-opus-5-5',
  label: 'Opus 5.5',
  provider: 'Claude plan',
  context: '1M',
  efforts: [EEffort.Low, EEffort.Medium],
  fast: true,
}

const haiku: ModelOption = { id: 'anthropic/claude-haiku-5-5', label: 'Haiku 5.5' }

describe('providerIdOfRef', () => {
  it('splits the provider off a model ref', () => {
    expect(providerIdOfRef('anthropic/claude-opus-5-5')).toBe('anthropic')
    expect(providerIdOfRef('anthropic')).toBe('anthropic')
  })
})

describe('option ids', () => {
  it('tags an id with its account only when one is chosen', () => {
    expect(optionIdOfChoice({ ref: 'anthropic/opus' })).toBe('anthropic/opus')
    expect(optionIdOfChoice({ ref: 'anthropic/opus', accountId: 'acc_1' })).toBe(
      'anthropic/opus#acc_1',
    )
  })

  it('reads the choice back out of an id', () => {
    expect(choiceOfOptionId('anthropic/opus#acc_1')).toEqual({
      ref: 'anthropic/opus',
      accountId: 'acc_1',
    })
    expect(choiceOfOptionId('anthropic/opus')).toEqual({ ref: 'anthropic/opus' })
  })
})

describe('accountModelOptionsOf', () => {
  it('offers one option per account when a provider has more than one', () => {
    const options = accountModelOptionsOf({
      models: [haiku],
      accounts: [personal, work],
    })
    expect(options.map((option) => option.id)).toEqual([
      'anthropic/claude-haiku-5-5#acc_personal',
      'anthropic/claude-haiku-5-5#acc_work',
    ])
    expect(options.map((option) => option.label)).toEqual([
      'Haiku 5.5 · dennislysenko@hotmail.com',
      'Haiku 5.5 · dennis@trycomp.ai',
    ])
  })

  it('keeps the model card details on every account option', () => {
    const options = accountModelOptionsOf({ models: [opus], accounts: [personal, work] })
    expect(options.map((option) => option.label)).toEqual([
      'Opus 5.5 · dennislysenko@hotmail.com',
      'Opus 5.5 · dennis@trycomp.ai',
    ])
    expect(options.map((option) => option.efforts)).toEqual([opus.efforts, opus.efforts])
    expect(options.map((option) => option.fast)).toEqual([true, true])
  })

  it('leaves a single-account provider untagged so the pointer decides', () => {
    expect(accountModelOptionsOf({ models: [haiku], accounts: [personal] })).toEqual([haiku])
  })

  it('ignores expired accounts', () => {
    const expired = accountOf({ id: 'acc_dead', label: 'dead', status: 'expired' })
    expect(accountModelOptionsOf({ models: [haiku], accounts: [personal, expired] })).toEqual([
      haiku,
    ])
  })

  it('keeps the chosen account among the options even when it is not offered', () => {
    const options = accountModelOptionsOf({
      models: [haiku],
      accounts: [],
      current: { ref: 'anthropic/claude-haiku-5-5', accountId: 'acc_gone' },
    })
    expect(options.map((option) => option.id)).toEqual([
      'anthropic/claude-haiku-5-5',
      'anthropic/claude-haiku-5-5#acc_gone',
    ])
    expect(options[1]?.label).toBe('Haiku 5.5')
  })

  it('does not duplicate an option the session already runs on', () => {
    const options = accountModelOptionsOf({
      models: [haiku],
      accounts: [personal, work],
      current: { ref: 'anthropic/claude-haiku-5-5', accountId: 'acc_work' },
    })
    expect(options).toHaveLength(2)
  })
})

describe('selectionOfChoice', () => {
  it('shows the pinned model, account, effort and fast flag', () => {
    expect(
      selectionOfChoice({
        ref: 'anthropic/claude-opus-5-5',
        accountId: 'acc_work',
        effort: 'high',
        fast: true,
      }),
    ).toEqual({ id: 'anthropic/claude-opus-5-5#acc_work', effort: EEffort.High, fast: true })
  })

  it('falls back to an unset selection for a session without a pinned model', () => {
    expect(selectionOfChoice(null).id).toBe('')
  })
})

describe('modelSetArgsOf', () => {
  it('carries the account when the pick named one', () => {
    expect(
      modelSetArgsOf({
        id: 'anthropic/claude-opus-5-5#acc_work',
        effort: EEffort.High,
        fast: false,
      }),
    ).toEqual({ model: 'anthropic/claude-opus-5-5', effort: 'high', accountId: 'acc_work' })
  })

  it('omits the account when the pick did not name one', () => {
    expect(
      modelSetArgsOf({ id: 'anthropic/claude-opus-5-5', effort: EEffort.Low, fast: true }),
    ).toEqual({ model: 'anthropic/claude-opus-5-5', effort: 'low', fast: true })
  })
})

describe('sessionCreateFieldsOf', () => {
  it('sends the model, effort, fast and account of the pick', () => {
    expect(
      sessionCreateFieldsOf({
        id: 'anthropic/claude-opus-5-5#acc_work',
        effort: EEffort.High,
        fast: false,
      }),
    ).toEqual({ model: 'anthropic/claude-opus-5-5', effort: 'high', accountId: 'acc_work' })
  })

  it('sends nothing when no model was picked', () => {
    expect(sessionCreateFieldsOf({ id: '', effort: EEffort.Medium, fast: false })).toEqual({})
  })
})

describe('plainSelectionOf', () => {
  it('drops the account tag for the v1 composer', () => {
    expect(
      plainSelectionOf({
        id: 'anthropic/claude-opus-5-5#acc_work',
        effort: EEffort.High,
        fast: false,
      }),
    ).toEqual({ id: 'anthropic/claude-opus-5-5', effort: EEffort.High, fast: false })
  })
})

describe('sessionModelOf', () => {
  it('reads the pinned model off a session row', () => {
    expect(sessionModelOf({ model: { ref: 'anthropic/opus', accountId: 'acc_1' } })).toEqual({
      ref: 'anthropic/opus',
      accountId: 'acc_1',
    })
  })

  it('reads a session that pins nothing', () => {
    expect(sessionModelOf({ model: null })).toBeNull()
    expect(sessionModelOf({})).toBeNull()
    expect(sessionModelOf(undefined)).toBeNull()
  })
})
