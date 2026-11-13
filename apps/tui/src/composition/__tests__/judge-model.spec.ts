import { describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  EEffort,
  ESettingsLayer,
  ESettingId,
  resolveSettings,
  type CredentialPort,
  type ModelChoice,
  type SettingsResolution,
} from '@dltech/atlas-core'
import { DEFAULT_MODEL_REF } from '@dltech/atlas-harness'

import { judgeChoiceFor, judgeModel } from '../judge-model'

const credentials: CredentialPort = {
  read: () => Promise.reject(new Error('no credential in this spec')),
  discard: () => Promise.resolve(),
}

const settled = (values: Record<string, string>): SettingsResolution =>
  resolveSettings({
    definitions: ATLAS_SETTINGS,
    layers: [{ layer: ESettingsLayer.Cloud, origin: 'spec', values }],
  })

const choiceOver = (values: Record<string, string>): ModelChoice =>
  judgeChoiceFor({ settled: settled(values) })

describe('judgeChoiceFor', () => {
  it('follows Main when no quick model is set', () => {
    expect(choiceOver({}).ref).toEqual(DEFAULT_MODEL_REF)
  })

  it('honours a quick model that names a real card', () => {
    expect(choiceOver({ [ESettingId.QuickModel]: 'openai/gpt-4.1-mini' }).ref).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4.1-mini',
    })
  })

  it('follows Main when the quick model names no card', () => {
    expect(choiceOver({ [ESettingId.QuickModel]: 'openai/gpt-nope' }).ref).toEqual(
      DEFAULT_MODEL_REF,
    )
  })

  it('inherits the effort Main runs when the quick row names none', () => {
    expect(choiceOver({ [ESettingId.ModelEffort]: 'high' }).effort).toBe(EEffort.High)
  })

  it('takes the effort the quick row names for its own model', () => {
    const choice = choiceOver({
      [ESettingId.QuickModel]: 'openai/gpt-4.1-mini',
      [ESettingId.QuickEffort]: 'low',
    })

    expect(choice.effort).toBe(EEffort.Low)
  })
})

describe('judgeModel', () => {
  it('builds the resolved choice through its own provider adapter', () => {
    const model = judgeModel({
      choice: {
        ref: { providerId: 'openai', modelId: 'gpt-4.1-mini' },
        effort: EEffort.Low,
        fast: false,
      },
      credentials,
    })

    expect(model.provider).toBe('openai')
    expect(model.modelId).toBe('gpt-4.1-mini')
  })

  it('refuses a provider no adapter answers for', () => {
    expect(() =>
      judgeModel({
        choice: {
          ref: { providerId: 'nobody', modelId: 'nothing' },
          effort: EEffort.Low,
          fast: false,
        },
        credentials,
      }),
    ).toThrow('no provider adapter can answer for nobody/nothing')
  })

  it('refuses a model the provider does not carry', () => {
    expect(() =>
      judgeModel({
        choice: {
          ref: { providerId: 'anthropic', modelId: 'claude-nope' },
          effort: EEffort.Low,
          fast: false,
        },
        credentials,
      }),
    ).toThrow('no provider adapter can answer for anthropic/claude-nope')
  })
})
