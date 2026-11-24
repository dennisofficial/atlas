import { describe, expect, it } from 'bun:test'

import { EEffort, UnknownModelRefError } from '@dltech/atlas-core'

import {
  defaultMainModelOf,
  sessionModelOf,
  settingsWithProjectOverUser,
  SHIPPED_DEFAULT_REF,
  type SessionModelInputs,
} from '../session-model'

const NO_ACCOUNTS: SessionModelInputs = {
  settings: new Map(),
  accounts: [],
  activeAccounts: [],
}

const setting = (value: string | boolean): string => `atlas-setting:v1:${JSON.stringify(value)}`

const withSettings = (settings: Record<string, string>): SessionModelInputs => ({
  ...NO_ACCOUNTS,
  settings: new Map(Object.entries(settings)),
})

const askOf = (args: {
  inputs: SessionModelInputs
  ask: { ref?: string; effort?: string; fast?: boolean }
}) => sessionModelOf({ ...args.inputs, ask: args.ask })

describe('defaultMainModelOf', () => {
  it('is the shipped default with its default effort when nothing is set', () => {
    expect(defaultMainModelOf(NO_ACCOUNTS)).toEqual({
      ref: SHIPPED_DEFAULT_REF,
      effort: EEffort.Medium,
      fast: false,
    })
  })

  it('uses the model.id and model.effort settings', () => {
    expect(
      defaultMainModelOf(
        withSettings({
          'model.id': setting('anthropic/claude-opus-5-5'),
          'model.effort': setting('high'),
        }),
      ),
    ).toEqual({
      ref: { providerId: 'anthropic', modelId: 'claude-opus-5-5' },
      effort: EEffort.High,
      fast: false,
    })
  })

  it('lets a project setting override the user setting', () => {
    const merged = settingsWithProjectOverUser({
      user: new Map([['model.id', setting('openai/gpt-5')]]),
      project: new Map([['model.id', setting('anthropic/claude-opus-5-5')]]),
    })
    expect(defaultMainModelOf({ ...NO_ACCOUNTS, settings: merged }).ref).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-opus-5-5',
    })
  })
})

describe('sessionModelOf', () => {
  it('pins the default when the caller asks for nothing', () => {
    expect(
      askOf({
        inputs: withSettings({ 'model.id': setting('anthropic/claude-opus-5-5') }),
        ask: {},
      }),
    ).toEqual({
      ref: { providerId: 'anthropic', modelId: 'claude-opus-5-5' },
      effort: EEffort.Medium,
      fast: false,
    })
  })

  it('clamps an asked effort to what the model offers', () => {
    expect(
      askOf({ inputs: NO_ACCOUNTS, ask: { ref: 'anthropic/claude-haiku-4-5', effort: 'xhigh' } }),
    ).toEqual({
      ref: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' },
      effort: EEffort.High,
      fast: false,
    })
  })

  it('keeps fast only where the model offers it', () => {
    expect(
      askOf({ inputs: NO_ACCOUNTS, ask: { ref: 'anthropic/claude-opus-5-5', fast: true } }).fast,
    ).toBe(true)
    expect(
      askOf({ inputs: NO_ACCOUNTS, ask: { ref: 'anthropic/claude-haiku-4-5', fast: true } }).fast,
    ).toBe(false)
  })

  it('carries the current effort over when the caller asks for no effort', () => {
    const chosen = sessionModelOf({
      ...NO_ACCOUNTS,
      ask: { ref: 'anthropic/claude-opus-5-5' },
      current: {
        ref: { providerId: 'anthropic', modelId: 'claude-opus-5-5' },
        effort: EEffort.Low,
        fast: false,
      },
    })
    expect(chosen.effort).toBe(EEffort.Low)
  })

  it('refuses a bare model id with the typed error and the refs that carry it', () => {
    const refusal = () => askOf({ inputs: NO_ACCOUNTS, ask: { ref: 'claude-opus-5-5' } })

    expect(refusal).toThrow(UnknownModelRefError)
    expect(refusal).toThrow(
      'Unknown model "claude-opus-5-5". Use the form "<provider>/<model>". Did you mean anthropic/claude-opus-5-5 or inference/claude-opus-5-5?',
    )
  })

  it('refuses a malformed model ref with the typed error and no hint', () => {
    const refusal = () => askOf({ inputs: NO_ACCOUNTS, ask: { ref: 'anthropic/' } })

    expect(refusal).toThrow(UnknownModelRefError)
    expect(refusal).toThrow('Unknown model "anthropic/". Use the form "<provider>/<model>".')
  })
})
