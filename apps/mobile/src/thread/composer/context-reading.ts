import { contextPercentOf } from '@dltech/atlas-client/session'
import {
  type AccountUsage,
  EMeterBand,
  formatUtilization,
  planUsageReadingsOf,
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

export type PopoverLine = {
  key: string
  text: string
  tone: EPopoverTone
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

const contextLineOf = (context: ContextMeter | null): PopoverLine => {
  const percent = ringPercentOf(context)
  return {
    key: 'context',
    text: percent === null ? 'Context not measured yet' : `Context ${percent}% used`,
    tone: contextToneOf(percent),
  }
}

const usageLinesOf = (usage: AccountUsage | null): readonly PopoverLine[] =>
  usage === null
    ? []
    : planUsageReadingsOf(usage).map((reading) => ({
        key: reading.kind,
        text: `${reading.short} ${formatUtilization(reading.utilization)}`,
        tone: TONE_OF_BAND[reading.band],
      }))

export const popoverLinesOf = ({
  context,
  usage,
}: {
  context: ContextMeter | null
  usage: AccountUsage | null
}): readonly PopoverLine[] => [contextLineOf(context), ...usageLinesOf(usage)]
