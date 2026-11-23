'use client'

import {
  DEFAULT_WARN_PERCENT,
  EUsageWindow,
  formatCountdown,
  formatUtilization,
  meterBand,
} from '@dltech/atlas-core'
import type { UsageReportDto, UsageWindowDto } from '@dltech/atlas-protocol'

import { METER_BAR, METER_TONE } from '@/lib/usage-tone'

import { useAccountUsage } from '@/features/sessions/data/use-account-usage'

import { relativeTime } from '../data/personal/relative-time'

const STALE_AFTER_MS = 5 * 60_000

const WINDOW_LABEL: Record<EUsageWindow, string> = {
  [EUsageWindow.FiveHour]: '5-hour',
  [EUsageWindow.SevenDay]: '7-day',
}

function WindowMeter(args: {
  label: string
  window: UsageWindowDto | null
  windowKind: EUsageWindow
  now: number
}) {
  const utilization = args.window?.utilization ?? null
  const band = meterBand({ utilization, warnAt: DEFAULT_WARN_PERCENT[args.windowKind] })
  const countdown = formatCountdown({ resetsAt: args.window?.resetsAt ?? null, now: args.now })
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-11 shrink-0 text-muted-foreground">{args.label}</span>
      {utilization === null ? (
        <span className="text-muted-foreground tabular-nums">{formatUtilization(utilization)}</span>
      ) : (
        <>
          <span aria-hidden className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
            <span
              className={`block h-full rounded-full ${METER_BAR[band]}`}
              style={{ width: `${utilization}%` }}
            />
          </span>
          <span className={`w-9 shrink-0 tabular-nums ${METER_TONE[band]}`}>
            {formatUtilization(utilization)}
          </span>
        </>
      )}
      {countdown === '' ? null : (
        <span className="text-muted-foreground tabular-nums">resets in {countdown}</span>
      )}
    </div>
  )
}

const ageOf = (args: { fetchedAt: string | null; now: number }): string | null => {
  if (args.fetchedAt === null) return null
  const readAt = Date.parse(args.fetchedAt)
  if (!Number.isFinite(readAt) || args.now - readAt < STALE_AFTER_MS) return null
  return `read ${relativeTime({ from: args.fetchedAt, now: args.now })}`
}

export function UsageMeters({ report, now }: { report: UsageReportDto; now: number }) {
  if (!report.metered) return null
  const age = ageOf({ fetchedAt: report.fetchedAt, now })
  return (
    <fieldset aria-label="Plan usage" className="flex flex-col gap-1.5 pt-1">
      <WindowMeter
        label={WINDOW_LABEL[EUsageWindow.FiveHour]}
        window={report.fiveHour}
        windowKind={EUsageWindow.FiveHour}
        now={now}
      />
      <WindowMeter
        label={WINDOW_LABEL[EUsageWindow.SevenDay]}
        window={report.sevenDay}
        windowKind={EUsageWindow.SevenDay}
        now={now}
      />
      {age === null ? null : <span className="text-xs text-muted-foreground">{age}</span>}
    </fieldset>
  )
}

export function UsageMeterRow({ accountId }: { accountId: string }) {
  const { report } = useAccountUsage({ input: { accountId }, turnEnds: 0 })
  if (report === null || report.metered === false) return null
  return <UsageMeters report={report} now={Date.now()} />
}
