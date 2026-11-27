import { contextPercentOf } from '@dltech/atlas-client/session'
import {
  type AccountUsage,
  EMeterBand,
  formatCountdown,
  formatUtilization,
  planUsageReadingsOf,
  WINDOW_LONG,
} from '@dltech/atlas-core'
import type { UsageReportDto } from '@dltech/atlas-protocol'

export type ContextMeter = {
  used: number | null
  window: number | null
}

export enum EPopoverTone {
  Foreground = 'foreground',
  Muted = 'muted',
  Warning = 'warning',
  Destructive = 'destructive',
}

export type PopoverMeter = {
  key: string
  label: string
  value: string
  fraction: number
  detail: string | null
  tone: EPopoverTone
}

export type PopoverSection = {
  key: string
  title: string | null
  meters: readonly PopoverMeter[]
}

export type ContextRingProps = {
  context: ContextMeter | null
  usage: UsageReportDto | null
}

const CONTEXT_WARN_PERCENT = 70
const CONTEXT_DANGER_PERCENT = 90

const TONE_OF_BAND: Record<EMeterBand, EPopoverTone> = {
  [EMeterBand.Unknown]: EPopoverTone.Muted,
  [EMeterBand.Normal]: EPopoverTone.Foreground,
  [EMeterBand.Warn]: EPopoverTone.Warning,
  [EMeterBand.Hot]: EPopoverTone.Destructive,
  [EMeterBand.Red]: EPopoverTone.Destructive,
  [EMeterBand.Spent]: EPopoverTone.Destructive,
}

export const ringPercentOf = (context: ContextMeter | null): number | null =>
  context === null ? null : contextPercentOf({ used: context.used, window: context.window })

export const contextToneOf = (percent: number | null): EPopoverTone => {
  if (percent === null) return EPopoverTone.Muted
  if (percent >= CONTEXT_DANGER_PERCENT) return EPopoverTone.Destructive
  if (percent >= CONTEXT_WARN_PERCENT) return EPopoverTone.Warning
  return EPopoverTone.Foreground
}

export const contextLabelOf = (context: ContextMeter | null): string => {
  const percent = ringPercentOf(context)
  return percent === null ? 'Context not measured yet' : `Context ${percent}%`
}

export const shownUsageOf = (usage: UsageReportDto | null): AccountUsage | null =>
  usage === null || usage.metered === false ? null : usage

const THOUSAND = 1_000
const MILLION = 1_000_000

const compactTokensOf = (tokens: number): string => {
  if (tokens < THOUSAND) return String(tokens)
  if (tokens < MILLION) return `${Math.round(tokens / THOUSAND)}k`
  return `${Number((tokens / MILLION).toFixed(1))}M`
}

const fractionOf = (percent: number | null): number =>
  percent === null ? 0 : Math.min(1, Math.max(0, percent / 100))

const contextDetailOf = (context: ContextMeter | null): string => {
  if (context?.used == null || context.window === null) return 'Not measured yet'
  return `${compactTokensOf(context.used)} of ${compactTokensOf(context.window)} tokens`
}

const contextMeterOf = (context: ContextMeter | null): PopoverMeter => {
  const percent = ringPercentOf(context)
  return {
    key: 'context',
    label: 'Context window',
    value: percent === null ? '—' : `${percent}%`,
    fraction: fractionOf(percent),
    detail: contextDetailOf(context),
    tone: contextToneOf(percent),
  }
}

const resetDetailOf = (args: { resetsAt: string | null; now: number }): string | null => {
  const countdown = formatCountdown(args)
  if (countdown === '') return null
  return countdown === 'now' ? 'Resets now' : `Resets in ${countdown}`
}

const usageMetersOf = (args: { usage: AccountUsage; now: number }): readonly PopoverMeter[] =>
  planUsageReadingsOf(args.usage).map((reading) => ({
    key: reading.kind,
    label: `${WINDOW_LONG[reading.kind]} limit`,
    value: formatUtilization(reading.utilization),
    fraction: fractionOf(reading.utilization),
    detail: resetDetailOf({ resetsAt: args.usage[reading.kind]?.resetsAt ?? null, now: args.now }),
    tone: TONE_OF_BAND[reading.band],
  }))

export const popoverSectionsOf = ({
  context,
  usage,
  now,
}: {
  context: ContextMeter | null
  usage: AccountUsage | null
  now: number
}): readonly PopoverSection[] => {
  const contextSection: PopoverSection = {
    key: 'context',
    title: null,
    meters: [contextMeterOf(context)],
  }
  if (usage === null) return [contextSection]
  return [
    contextSection,
    { key: 'plan', title: 'Plan usage', meters: usageMetersOf({ usage, now }) },
  ]
}
