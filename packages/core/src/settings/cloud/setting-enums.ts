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

export enum EImageModelWire {
  Gemini31FlashImage = 'google/gemini-3.1-flash-image',
  Gemini3ProImage = 'google/gemini-3-pro-image',
  MaiImage27 = 'microsoft/mai-image-2.7',
  MaiImage27Flash = 'microsoft/mai-image-2.7-flash',
  GrokImagineImage20 = 'spacexai/grok-imagine-image-2.0',
}

export const DEFAULT_IMAGE_MODEL_WIRE = EImageModelWire.Gemini31FlashImage

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

export const effortOrInheritSchema = z.union([z.literal(''), effortSchema])

// https://vercel.com/docs/sandbox/pricing — 1 or an even 2..32 vCPUs, 2 GB RAM each
export const SANDBOX_VCPU_SIZES = [
  1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32,
] as const

export const DEFAULT_SANDBOX_VCPUS = 2

export const SANDBOX_MEMORY_GB_PER_VCPU = 2

export const SANDBOX_VCPU_PLAN_CAP_NOTE = 'Hobby up to 4 vCPU · Pro up to 8 · Enterprise up to 32'

// https://www.agent37.com/docs/agents-api/instance-sizing.md — an Agent37 vm disk runs from 2 GB to
// 100 GB and only ever grows, so the sizes offered for a new pod start at the shipped default.
export const SANDBOX_DISK_GB_SIZES = [20, 30, 40, 60, 80, 100] as const

export const DEFAULT_SANDBOX_DISK_GB = 20

export enum EVercelPlan {
  Hobby = 'hobby',
  Pro = 'pro',
  Enterprise = 'enterprise',
  Unknown = 'unknown',
}

export const vercelPlanSchema = z.enum(EVercelPlan)

// https://vercel.com/docs/sandbox/pricing — Hobby 4, Pro 8, Enterprise 32 vCPUs
export const VERCEL_PLAN_MAX_VCPUS: Record<EVercelPlan, number> = {
  [EVercelPlan.Hobby]: 4,
  [EVercelPlan.Pro]: 8,
  [EVercelPlan.Enterprise]: 32,
  [EVercelPlan.Unknown]: 32,
}

export const sandboxSizesOfPlan = (plan: EVercelPlan): readonly number[] => {
  const cap = VERCEL_PLAN_MAX_VCPUS[plan]
  return SANDBOX_VCPU_SIZES.filter((size) => size <= cap)
}

export const vercelPlanCapNote = (plan: EVercelPlan): string => {
  if (plan === EVercelPlan.Unknown) return SANDBOX_VCPU_PLAN_CAP_NOTE
  const cap = VERCEL_PLAN_MAX_VCPUS[plan]
  return `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan: up to ${cap} vCPU`
}

export const sandboxVcpusSchema = z
  .number()
  .int()
  .refine((value) => (SANDBOX_VCPU_SIZES as readonly number[]).includes(value), {
    message: 'must be 1 or an even number from 2 to 32',
  })

export const sandboxMemoryGbSchema = z.number().int().min(1).max(64)

export const sandboxDiskGbSchema = z
  .number()
  .int()
  .refine((value) => (SANDBOX_DISK_GB_SIZES as readonly number[]).includes(value), {
    message: 'must be 20, 30, 40, 60, 80 or 100 GB',
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
