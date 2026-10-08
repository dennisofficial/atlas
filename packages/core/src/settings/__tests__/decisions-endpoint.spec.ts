import { describe, expect, it } from 'bun:test'

import {
  decisionsEndpointOf,
  decisionsProviderIn,
  decisionsTokenNameOf,
} from '../decisions-endpoint'
import {
  DECISIONS_PRESETS,
  decisionsPresetOfUrl,
  EDecisionsProtocol,
  EDecisionsProvider,
} from '../decisions-presets'
import { ESettingsLayer } from '../layers'
import { ATLAS_SETTINGS, ESettingId } from '../registry'
import { resolveSettings } from '../resolve'

const resolutionOf = (values: Record<string, unknown> = {}) =>
  resolveSettings({
    definitions: ATLAS_SETTINGS,
    layers: [{ layer: ESettingsLayer.User, origin: 'user', values }],
  })

const endpointOf = (values: Record<string, unknown>, token: string | undefined) =>
  decisionsEndpointOf({ resolution: resolutionOf(values), token })

describe('decisionsEndpointOf', () => {
  it('defaults to the typesafe preset once it has a key', () => {
    expect(endpointOf({}, 'sk')).toEqual({
      protocol: EDecisionsProtocol.Jev,
      url: 'https://api.typesafe.ai',
      model: 'jev-latest',
      tokenName: 'decisions.token.typesafe',
    })
  })

  it('is unconfigured on a preset without a key', () => {
    expect(endpointOf({}, undefined)).toBeNull()
    expect(endpointOf({ [ESettingId.DecisionsProvider]: 'openai' }, '')).toBeNull()
  })

  it('maps vercel to the gateway route over the Jev protocol', () => {
    expect(endpointOf({ [ESettingId.DecisionsProvider]: 'vercel' }, 'sk')).toEqual({
      protocol: EDecisionsProtocol.Jev,
      url: 'https://ai-gateway.vercel.sh/typesafe',
      model: 'jev-latest',
      tokenName: 'decisions.token.vercel',
    })
  })

  it('maps openai to /v1/decisions on its own model', () => {
    expect(endpointOf({ [ESettingId.DecisionsProvider]: 'openai' }, 'sk')).toEqual({
      protocol: EDecisionsProtocol.OpenAi,
      url: 'https://api.openai.com/v1/decisions',
      model: 'gpt-6-luna',
      tokenName: 'decisions.token.openai',
    })
  })

  it('ignores a stale url and model while a preset is chosen', () => {
    const endpoint = endpointOf(
      {
        [ESettingId.DecisionsProvider]: 'vercel',
        [ESettingId.DecisionsUrl]: 'http://elsewhere',
        [ESettingId.DecisionsModel]: 'other',
      },
      'sk',
    )
    expect(endpoint?.url).toBe(DECISIONS_PRESETS[EDecisionsProvider.Vercel].url)
    expect(endpoint?.model).toBe('jev-latest')
  })

  it('takes the url and model from the settings on custom, tokenless allowed', () => {
    expect(
      endpointOf(
        {
          [ESettingId.DecisionsProvider]: 'custom',
          [ESettingId.DecisionsUrl]: ' http://laya.local:8080 ',
          [ESettingId.DecisionsModel]: 'laya-1',
        },
        undefined,
      ),
    ).toEqual({
      protocol: EDecisionsProtocol.Jev,
      url: 'http://laya.local:8080',
      model: 'laya-1',
      tokenName: 'decisions.token.custom',
    })
  })

  it('falls back to the Jev model on custom with a blank model, and is unconfigured without a url', () => {
    expect(
      endpointOf(
        { [ESettingId.DecisionsProvider]: 'custom', [ESettingId.DecisionsUrl]: 'http://x', [ESettingId.DecisionsModel]: '' },
        undefined,
      )?.model,
    ).toBe('jev-latest')
    expect(endpointOf({ [ESettingId.DecisionsProvider]: 'custom' }, 'sk')).toBeNull()
  })
})

describe('decisions provider helpers', () => {
  it('names the vault key per provider', () => {
    expect(decisionsTokenNameOf({ provider: EDecisionsProvider.OpenAi })).toBe('decisions.token.openai')
  })

  it('reads the provider from the resolution with typesafe as the fallback', () => {
    expect(decisionsProviderIn({ resolution: resolutionOf() })).toBe(EDecisionsProvider.Typesafe)
    expect(
      decisionsProviderIn({ resolution: resolutionOf({ [ESettingId.DecisionsProvider]: 'custom' }) }),
    ).toBe(EDecisionsProvider.Custom)
  })

  it('recognises a preset url with or without the route, slash or case', () => {
    expect(decisionsPresetOfUrl({ url: 'https://API.typesafe.ai/' })).toBe(EDecisionsProvider.Typesafe)
    expect(decisionsPresetOfUrl({ url: 'https://api.typesafe.ai/v1/systemone' })).toBe(EDecisionsProvider.Typesafe)
    expect(decisionsPresetOfUrl({ url: 'https://api.openai.com/v1/decisions' })).toBe(EDecisionsProvider.OpenAi)
    expect(decisionsPresetOfUrl({ url: 'http://laya.local' })).toBeUndefined()
  })
})
