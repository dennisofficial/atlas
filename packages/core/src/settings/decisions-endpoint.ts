import { DECISIONS_PRESETS, DEFAULT_DECISIONS_MODEL, DEFAULT_DECISIONS_PROVIDER, decisionsProviderOf, EDecisionsProtocol, EDecisionsProvider } from './decisions-presets'
import { choiceValueOf, textValueOf, type SettingsResolution } from './resolve'
import { ESettingId } from './registry'

export type DecisionsEndpoint = {
  protocol: EDecisionsProtocol
  url: string
  model: string
  tokenName: string
}

export const decisionsTokenNameOf = (args: { provider: EDecisionsProvider }): string =>
  `${ESettingId.DecisionsToken}.${args.provider}`

export const decisionsProviderIn = (args: { resolution: SettingsResolution }): EDecisionsProvider =>
  decisionsProviderOf(
    choiceValueOf({
      resolution: args.resolution,
      id: ESettingId.DecisionsProvider,
      fallback: DEFAULT_DECISIONS_PROVIDER,
    }),
  ) ?? DEFAULT_DECISIONS_PROVIDER

export function decisionsEndpointOf(args: {
  resolution: SettingsResolution
  token: string | undefined
}): DecisionsEndpoint | null {
  const { resolution } = args
  const provider = decisionsProviderIn({ resolution })
  const tokenName = decisionsTokenNameOf({ provider })

  if (provider !== EDecisionsProvider.Custom) {
    if (args.token === undefined || args.token.length === 0) return null
    const preset = DECISIONS_PRESETS[provider]
    return { protocol: preset.protocol, url: preset.url, model: preset.model, tokenName }
  }

  const url = textValueOf({ resolution, id: ESettingId.DecisionsUrl }).trim()
  if (url.length === 0) return null
  const model = textValueOf({ resolution, id: ESettingId.DecisionsModel }).trim()
  return {
    protocol: EDecisionsProtocol.Jev,
    url,
    model: model.length === 0 ? DEFAULT_DECISIONS_MODEL : model,
    tokenName,
  }
}
