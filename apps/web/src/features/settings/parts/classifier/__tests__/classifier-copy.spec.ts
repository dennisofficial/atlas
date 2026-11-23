import { describe, expect, it } from 'bun:test'

import {
  CLASSIFIER_MODEL_KEY,
  CLASSIFIER_OFF_VALUE,
  classifierAvailabilityIn,
  classifierChanges,
  classifierFeaturesOf,
  classifierModelItems,
  classifierSettingsFrom,
  classifierStatusOf,
  classifierSuggestionOf,
  classifierTestLineOf,
  credentialOfAccounts,
  providerIdOf,
} from '../classifier-copy'
import type { Account } from '../../../data/personal/accounts-api'

const GATEWAY_KEY = 'gateway/typesafe-ai/jev'
const TYPESAFE_DIRECT = 'typesafe/jev-latest'
const OPENAI_DECISIONS = 'openai/gpt-6-luna'

const account = (args: { id: string; provider: string; kind: string }): Account => ({
  id: args.id,
  provider: args.provider,
  kind: args.kind,
  label: args.kind === 'api-key' ? 'Key saved' : args.provider,
  status: 'active',
  createdAt: '2026-11-01T00:00:00.000Z',
})

const gatewayKey = [account({ id: 'acc_gw', provider: 'gateway', kind: 'api-key' })]

describe('credentialOfAccounts', () => {
  it('prefers an api-key account over a plan for the same provider', () => {
    const credentialOf = credentialOfAccounts([
      account({ id: 'acc_plan', provider: 'openai', kind: 'oauth' }),
      account({ id: 'acc_key', provider: 'openai', kind: 'api-key' }),
    ])
    expect(credentialOf('openai')).toEqual({ kind: 'api-key', accountId: 'acc_key' })
  })

  it('answers a plan account and null when nothing is held', () => {
    const credentialOf = credentialOfAccounts([
      account({ id: 'acc_plan', provider: 'openai', kind: 'oauth' }),
    ])
    expect(credentialOf('openai')).toEqual({ kind: 'plan', accountId: 'acc_plan' })
    expect(credentialOf('gateway')).toBeNull()
  })
})

describe('classifierStatusOf', () => {
  it('reads the not-set-up state', () => {
    const availability = classifierAvailabilityIn({ stored: '', accounts: gatewayKey })
    expect(classifierStatusOf(availability)).toEqual({
      tone: 'off',
      text: 'No classifier is set. Skill suggestion and the Jev code review are off.',
    })
  })

  it('reads the working state', () => {
    const availability = classifierAvailabilityIn({ stored: GATEWAY_KEY, accounts: gatewayKey })
    expect(classifierStatusOf(availability)).toEqual({
      tone: 'on',
      text: 'Vercel AI Gateway is connected.',
    })
  })

  it('reads a missing credential', () => {
    const availability = classifierAvailabilityIn({ stored: TYPESAFE_DIRECT, accounts: [] })
    expect(classifierStatusOf(availability)).toEqual({
      tone: 'off',
      text: 'Off — TypeSafe AI is not connected.',
    })
  })

  it('reads a plan-only account', () => {
    const availability = classifierAvailabilityIn({
      stored: OPENAI_DECISIONS,
      accounts: [account({ id: 'acc_plan', provider: 'openai', kind: 'oauth' })],
    })
    expect(classifierStatusOf(availability)).toEqual({
      tone: 'off',
      text: 'Off — OpenAI is connected by a plan, which cannot serve a classifier.',
    })
  })

  it('reports a stored ref that is not a decision model', () => {
    const availability = classifierAvailabilityIn({ stored: 'openai/gpt-5', accounts: [] })
    expect(classifierStatusOf(availability)).toEqual({
      tone: 'off',
      text: 'Off — the chosen model is not a decision model.',
    })
  })
})

describe('classifierModelItems', () => {
  it('offers off and the three decision models by ref', () => {
    expect(classifierModelItems()).toEqual([
      { value: CLASSIFIER_OFF_VALUE, label: 'Off' },
      { value: TYPESAFE_DIRECT, label: 'Jev, direct (TypeSafe)' },
      { value: GATEWAY_KEY, label: 'Jev through Vercel AI Gateway' },
      { value: OPENAI_DECISIONS, label: 'OpenAI Decisions' },
    ])
  })
})

describe('classifierSuggestionOf', () => {
  it('suggests the first decision model with a saved key', () => {
    expect(classifierSuggestionOf(gatewayKey)).toEqual({
      ref: GATEWAY_KEY,
      label: 'Jev through Vercel AI Gateway',
      providerLabel: 'Vercel AI Gateway',
    })
  })

  it('suggests nothing without a key or with a plan only', () => {
    expect(classifierSuggestionOf([])).toBeUndefined()
    expect(
      classifierSuggestionOf([account({ id: 'acc_plan', provider: 'openai', kind: 'oauth' })]),
    ).toBeUndefined()
  })
})

describe('classifierTestLineOf', () => {
  it('reads a pass and a fault', () => {
    expect(classifierTestLineOf({ ok: true, model: 'typesafe-ai/jev', ms: 210 })).toBe(
      '● Working — typesafe-ai/jev, 210 ms',
    )
    expect(classifierTestLineOf({ ok: false, fault: 'rejected', detail: '401: refused' })).toBe(
      'Off — 401: refused',
    )
    expect(classifierTestLineOf(null)).toBeUndefined()
  })
})

describe('classifierFeaturesOf', () => {
  it('reads off for both features when there is no classifier', () => {
    expect(classifierFeaturesOf({ on: false, skillsSuggest: true, qualityEnabled: true })).toEqual([
      {
        label: 'Skill suggestion',
        state: 'Off — no classifier',
        href: '/settings/skills',
        linkLabel: 'Skills',
      },
      {
        label: 'Jev code review',
        state: 'Off — no classifier',
        href: '/settings/quality',
        linkLabel: 'Code Quality',
      },
    ])
  })

  it('reads each feature switch once the classifier is on', () => {
    const rows = classifierFeaturesOf({ on: true, skillsSuggest: true, qualityEnabled: false })
    expect(rows[0]?.state).toBe('On with the classifier')
    expect(rows[1]?.state).toBe('Off — its own switch is off')
  })
})

describe('classifier settings draft', () => {
  it('reads the stored ref and writes it back', () => {
    const values = new Map([[CLASSIFIER_MODEL_KEY, GATEWAY_KEY]])
    const saved = classifierSettingsFrom(values)
    expect(saved).toEqual({ model: GATEWAY_KEY })
    expect(classifierChanges({ saved, draft: { model: TYPESAFE_DIRECT } })).toEqual({
      [CLASSIFIER_MODEL_KEY]: TYPESAFE_DIRECT,
    })
  })

  it('clears the setting when the model is off', () => {
    const saved = { model: GATEWAY_KEY }
    expect(classifierChanges({ saved, draft: { model: CLASSIFIER_OFF_VALUE } })).toEqual({
      [CLASSIFIER_MODEL_KEY]: null,
    })
    expect(classifierChanges({ saved, draft: saved })).toEqual({})
  })
})

describe('providerIdOf', () => {
  it('maps every decision provider to its API-key provider id', () => {
    expect(providerIdOf('typesafe')).toBe('typesafe')
    expect(providerIdOf('gateway')).toBe('gateway')
    expect(providerIdOf('openai')).toBe('openai')
    expect(providerIdOf('anthropic')).toBe('anthropic')
    expect(() => providerIdOf('nope')).toThrow()
  })
})
