import { z } from 'zod'

export enum EEffortLevel {
  Off = 'off',
  Minimal = 'minimal',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  XHigh = 'xhigh',
  Max = 'max',
}

export enum EModelPreset {
  Fast = 'fast',
  Balanced = 'balanced',
  Thorough = 'thorough',
  Custom = 'custom',
}

export enum EPlacementChooserShape {
  Chip = 'chip',
  Hero = 'hero',
}

export enum EVerdictTiming {
  FailFast = 'fail-fast',
  Settled = 'settled',
}

export enum ETheme {
  Dark = 'dark',
  Light = 'light',
  System = 'system',
}

export enum EDensity {
  Comfortable = 'comfortable',
  Compact = 'compact',
}

export enum EClassifierModeWire {
  Off = 'off',
  Shadow = 'shadow',
  Nudge = 'nudge',
}

export enum EDecisionsProviderWire {
  Typesafe = 'typesafe',
  Vercel = 'vercel',
  OpenAi = 'openai',
  Custom = 'custom',
}

export enum EWebSearchBackendWire {
  DuckDuckGo = 'duckduckgo',
  Jina = 'jina',
  Tavily = 'tavily',
  Exa = 'exa',
  Brave = 'brave',
  SearXNG = 'searxng',
}

export const DEFAULT_DECISIONS_PROVIDER_WIRE = EDecisionsProviderWire.Typesafe

export const DEFAULT_DECISIONS_MODEL_WIRE = 'jev-latest'

export const NOTIFY_EVENT_IDS = [
  'finished',
  'approval',
  'errored',
  'checks',
  'mention',
  'paused',
] as const

export const NOTIFY_CHANNEL_IDS = ['inApp', 'push', 'email'] as const

export const QUIET_HOUR_PATTERN = /^([01]\d|2[0-3]):00$/

export const effortSchema = z.enum(EEffortLevel)

export const sandboxVcpusSchema = z
  .number()
  .int()
  .min(2)
  .max(8)
  .refine((value) => value % 2 === 0, { message: 'must be an even number' })

function isModelRef(value: string): boolean {
  const separator = value.indexOf('/')
  if (separator < 0) return false
  return separator > 0 && separator < value.length - 1
}

export const modelRefSettingSchema = z
  .string()
  .refine((value) => value === '' || isModelRef(value), {
    message: 'must be empty or a provider/model reference',
  })

const ABSOLUTE_HTTP_URL = /^https?:\/\/\S+$/

export const decisionsUrlSchema = z
  .string()
  .refine((value) => value === '' || ABSOLUTE_HTTP_URL.test(value.trim()), {
    message: 'must be empty or an absolute http(s) URL',
  })
