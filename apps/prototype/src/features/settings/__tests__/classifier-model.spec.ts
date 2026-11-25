import { describe, expect, test } from 'bun:test'

import {
  CLASSIFIER_OFF_VALUE,
  classifierAvailabilityIn,
  classifierFeaturesOf,
  classifierKeyLabelOf,
  classifierModelItems,
  classifierStatusOf,
  classifierSuggestionOf,
  classifierTestOf,
  EClassifierOffReason,
} from '../fixtures/settings-classifier'
import {
  CURRENT_PROVIDERS,
  EProvider,
  SEVERAL_KEYS_PROVIDERS,
} from '../fixtures/settings-providers'

const MODEL_OFF = CLASSIFIER_OFF_VALUE
const MODEL_ANTHROPIC = 'anthropic/claude-haiku-4-5'
const MODEL_OPENAI = 'openai/gpt-5-mini'
const MODEL_TYPESAFE = 'typesafe/jev-1'

const KEYED = SEVERAL_KEYS_PROVIDERS.accounts
const PLANS_ONLY = CURRENT_PROVIDERS.accounts

describe('classifier model items', () => {
  test('off comes first, then the decision models', () => {
    const items = classifierModelItems()
    expect(items[0]).toEqual({ value: MODEL_OFF, label: 'Off' })
    expect(items.map((item) => item.value)).toContain(MODEL_ANTHROPIC)
    expect(items.map((item) => item.value)).toContain(MODEL_OPENAI)
    expect(items.map((item) => item.value)).toContain(MODEL_TYPESAFE)
  })
})

describe('classifier availability', () => {
  test('a model whose provider holds an API key is on', () => {
    expect(classifierAvailabilityIn({ stored: MODEL_ANTHROPIC, accounts: KEYED })).toMatchObject({
      on: true,
      model: { label: 'Claude Haiku 4.5', provider: EProvider.Anthropic },
    })
  })

  test('a plan-only provider cannot serve a classifier', () => {
    expect(classifierAvailabilityIn({ stored: MODEL_ANTHROPIC, accounts: PLANS_ONLY })).toEqual({
      on: false,
      reason: EClassifierOffReason.PlanHasNoKey,
      provider: EProvider.Anthropic,
    })
  })

  test('a provider with no account is not connected', () => {
    expect(classifierAvailabilityIn({ stored: MODEL_TYPESAFE, accounts: KEYED })).toEqual({
      on: false,
      reason: EClassifierOffReason.NotConnected,
      provider: EProvider.Typesafe,
    })
  })

  test('off has no model', () => {
    expect(classifierAvailabilityIn({ stored: MODEL_OFF, accounts: KEYED })).toEqual({
      on: false,
      reason: EClassifierOffReason.NoModel,
    })
  })
})

describe('classifier status', () => {
  test('names the connected provider', () => {
    const availability = classifierAvailabilityIn({ stored: MODEL_ANTHROPIC, accounts: KEYED })
    expect(classifierStatusOf(availability)).toEqual({
      tone: 'on',
      text: 'Anthropic is connected.',
    })
  })

  test('says both features are off without a classifier', () => {
    const availability = classifierAvailabilityIn({ stored: MODEL_OFF, accounts: KEYED })
    expect(classifierStatusOf(availability)).toEqual({
      tone: 'off',
      text: 'No classifier is set. Skill suggestion and the Jev code review are off.',
    })
  })

  test('explains a plan-only provider and a missing one', () => {
    const plan = classifierAvailabilityIn({ stored: MODEL_ANTHROPIC, accounts: PLANS_ONLY })
    const missing = classifierAvailabilityIn({ stored: MODEL_TYPESAFE, accounts: KEYED })
    expect(classifierStatusOf(plan).text).toBe(
      'Off — Anthropic is connected by a plan, which cannot serve a classifier.',
    )
    expect(classifierStatusOf(missing).text).toBe('Off — TypeSafe AI is not connected.')
  })
})

describe('classifier test line', () => {
  test('reports the model name when the classifier works', () => {
    const availability = classifierAvailabilityIn({ stored: MODEL_ANTHROPIC, accounts: KEYED })
    expect(classifierTestOf(availability)).toEqual({
      ok: true,
      text: '● Working — Claude Haiku 4.5, 412 ms',
    })
  })

  test('reports off when there is no working key', () => {
    const availability = classifierAvailabilityIn({ stored: MODEL_OPENAI, accounts: PLANS_ONLY })
    expect(classifierTestOf(availability)).toEqual({
      ok: false,
      text: 'Off — no working key for this classifier.',
    })
  })
})

describe('classifier suggestion', () => {
  test('picks the first model whose provider already has a key', () => {
    expect(classifierSuggestionOf(KEYED)?.ref).toBe(MODEL_ANTHROPIC)
  })

  test('suggests nothing when every provider is a plan or missing', () => {
    expect(classifierSuggestionOf(PLANS_ONLY)).toBeUndefined()
  })
})

describe('classifier key label', () => {
  test('prefers the API key account over a plan', () => {
    expect(classifierKeyLabelOf({ accounts: KEYED, provider: EProvider.Anthropic })).toBe('Work')
  })

  test('is null without an account', () => {
    expect(classifierKeyLabelOf({ accounts: KEYED, provider: EProvider.OpenAI })).toBe(
      'dennis.elementauto@gmail.com',
    )
  })
})

describe('classifier features', () => {
  test('both features follow the classifier when their own switch is on', () => {
    const rows = classifierFeaturesOf({ on: true, skillsSuggest: true, qualityEnabled: true })
    expect(rows.map((row) => row.state)).toEqual([
      'On with the classifier',
      'On with the classifier',
    ])
    expect(rows.map((row) => row.href)).toEqual(['/settings/skills', '/settings/quality'])
  })

  test('an off classifier turns both features off', () => {
    const rows = classifierFeaturesOf({ on: false, skillsSuggest: true, qualityEnabled: true })
    expect(rows.map((row) => row.state)).toEqual(['Off — no classifier', 'Off — no classifier'])
  })

  test('an own switch that is off keeps its feature off', () => {
    const rows = classifierFeaturesOf({ on: true, skillsSuggest: false, qualityEnabled: true })
    expect(rows.map((row) => row.state)).toEqual([
      'Off — its own switch is off',
      'On with the classifier',
    ])
  })
})
