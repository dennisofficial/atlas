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

// https://vercel.com/docs/sandbox/pricing — 1 or an even 2..32 vCPUs, 2 GB RAM each
export const SANDBOX_VCPU_SIZES = [
  1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32,
] as const

export const DEFAULT_SANDBOX_VCPUS = 2

export const SANDBOX_MEMORY_GB_PER_VCPU = 2

export const SANDBOX_VCPU_PLAN_CAP_NOTE = 'Hobby up to 4 vCPU · Pro up to 8 · Enterprise up to 32'

export const sandboxVcpusSchema = z
  .number()
  .int()
  .refine((value) => (SANDBOX_VCPU_SIZES as readonly number[]).includes(value), {
    message: 'must be 1 or an even number from 2 to 32',
  })

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
