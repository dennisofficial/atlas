'use client'

import { providerUsageAgeOf, providerUsageWindowsOf } from '@dltech/atlas-client/settings'
import type { UsageReportDto } from '@dltech/atlas-protocol'
import { METER_BAR, METER_TONE } from '@/lib/usage-tone'
import { useAccountUsage } from '@/features/sessions/data/use-account-usage'

export function UsageMeters({ report, now }: { report: UsageReportDto; now: number }) {
  if (!report.metered) return null
  const age = providerUsageAgeOf({ fetchedAt: report.fetchedAt, now })
  return (
    <fieldset aria-label="Plan usage" className="flex flex-col gap-1.5 pt-1">
      {providerUsageWindowsOf({ report, now }).map((window) => (
        <div key={window.key} className="flex items-center gap-2 text-xs">
          <span className="w-11 shrink-0 text-muted-foreground">{window.label}</span>
          {window.utilization === null ? (
            <span className="text-muted-foreground tabular-nums">{window.text}</span>
          ) : (
            <>
              <span aria-hidden className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                <span
                  className={`block h-full rounded-full ${METER_BAR[window.band]}`}
                  style={{ width: `${window.percent}%` }}
                />
              </span>
              <span className={`w-9 shrink-0 tabular-nums ${METER_TONE[window.band]}`}>
                {window.text}
              </span>
            </>
          )}
          {window.countdown === '' ? null : (
            <span className="text-muted-foreground tabular-nums">resets in {window.countdown}</span>
          )}
        </div>
      ))}
      {age === null ? null : <span className="text-xs text-muted-foreground">{age}</span>}
    </fieldset>
  )
}

export function UsageMeterRow({ accountId }: { accountId: string }) {
  const { report } = useAccountUsage({ input: { accountId }, turnEnds: 0 })
  if (report === null || report.metered === false) return null
  return <UsageMeters report={report} now={Date.now()} />
}
