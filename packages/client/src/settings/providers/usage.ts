import {
  DEFAULT_WARN_PERCENT,
  EUsageWindow,
  formatCountdown,
  formatUtilization,
  meterBand,
  shownWindowsOf,
} from '@dltech/atlas-core'
import type { UsageReportDto } from '@dltech/atlas-protocol'
import { relativeTime } from '../account/relative-time'

export const providerUsageAgeOf = (args: {
  fetchedAt: string | null
  now: number
}): string | null => {
  if (args.fetchedAt === null) return null
  const readAt = Date.parse(args.fetchedAt)
  if (!Number.isFinite(readAt) || args.now - readAt < 5 * 60_000) return null
  return `read ${relativeTime({ from: args.fetchedAt, now: args.now })}`
}
export const providerUsageWindowsOf = ({ report, now }: { report: UsageReportDto; now: number }) =>
  report.metered
    ? shownWindowsOf(report).map((key) => {
        const utilization = report[key]?.utilization ?? null
        return {
          key,
          label: key === EUsageWindow.FiveHour ? '5-hour' : '7-day',
          utilization,
          percent: utilization === null ? 0 : Math.max(0, Math.min(100, utilization)),
          text: formatUtilization(utilization),
          band: meterBand({ utilization, warnAt: DEFAULT_WARN_PERCENT[key] }),
          countdown: formatCountdown({ resetsAt: report[key]?.resetsAt ?? null, now }),
        }
      })
    : []
