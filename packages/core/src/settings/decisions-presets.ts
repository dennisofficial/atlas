import { JEV_MODEL } from '../policy/classifier/jev'

export enum EDecisionsProvider {
  Typesafe = 'typesafe',
  Vercel = 'vercel',
  OpenAi = 'openai',
  Custom = 'custom',
}

export enum EDecisionsProtocol {
  Jev = 'jev',
  OpenAi = 'openai',
}

export type EDecisionsPresetProvider = Exclude<EDecisionsProvider, EDecisionsProvider.Custom>

export type DecisionsPreset = {
  url: string
  model: string
  protocol: EDecisionsProtocol
}

export const DEFAULT_DECISIONS_PROVIDER = EDecisionsProvider.Typesafe

export const DEFAULT_DECISIONS_MODEL = JEV_MODEL

export const DECISIONS_PRESETS: Readonly<Record<EDecisionsPresetProvider, DecisionsPreset>> = {
  [EDecisionsProvider.Typesafe]: {
    url: 'https://api.typesafe.ai',
    model: JEV_MODEL,
    protocol: EDecisionsProtocol.Jev,
  },
  [EDecisionsProvider.Vercel]: {
    url: 'https://ai-gateway.vercel.sh/typesafe',
    model: JEV_MODEL,
    protocol: EDecisionsProtocol.Jev,
  },
  [EDecisionsProvider.OpenAi]: {
    url: 'https://api.openai.com/v1/decisions',
    model: 'gpt-6-luna',
    protocol: EDecisionsProtocol.OpenAi,
  },
}

export const decisionsProviderOf = (value: string): EDecisionsProvider | undefined =>
  Object.values(EDecisionsProvider).find((provider) => provider === value)

const comparableUrl = (url: string): string =>
  url
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/\/v1\/systemone$/, '')

export function decisionsPresetOfUrl(args: { url: string }): EDecisionsPresetProvider | undefined {
  const wanted = comparableUrl(args.url)
  const presets = Object.entries(DECISIONS_PRESETS) as [EDecisionsPresetProvider, DecisionsPreset][]
  return presets.find(([, preset]) => comparableUrl(preset.url) === wanted)?.[0]
}
