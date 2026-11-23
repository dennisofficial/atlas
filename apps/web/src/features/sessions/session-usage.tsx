'use client'

import {
  DEFAULT_WARN_PERCENT,
  EAuthProvider,
  EUsageWindow,
  formatCountdown,
  formatUtilization,
  meterBand,
  parseRef,
} from '@dltech/atlas-core'
import type { SessionModelChoice, UsageReportDto, UsageWindowDto } from '@dltech/atlas-protocol'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@dltech/atlas-ui/components/hover-card'

import { METER_TONE } from '@/lib/usage-tone'

import { useTurnEndCount } from '@/features/threads/data/use-git-changes'

import { useAccountUsage } from './data/use-account-usage'

const PROVIDER_OF_ID: Record<string, EAuthProvider> = {
  anthropic: EAuthProvider.Anthropic,
  openai: EAuthProvider.OpenAI,
  openrouter: EAuthProvider.OpenRouter,
  inference: EAuthProvider.Inference,
  gateway: EAuthProvider.Gateway,
  typesafe: EAuthProvider.Typesafe,
}

export const usageProviderOf = (
  choice: SessionModelChoice | null | undefined,
): EAuthProvider | null => {
  const providerId =
    choice === null || choice === undefined ? undefined : parseRef(choice.ref)?.providerId
  if (providerId === undefined) return null
  return PROVIDER_OF_ID[providerId] ?? null
}

function WindowReading(args: {
  short: string
  window: UsageWindowDto | null
  windowKind: EUsageWindow
}) {
  const utilization = args.window?.utilization ?? null
  const band = meterBand({ utilization, warnAt: DEFAULT_WARN_PERCENT[args.windowKind] })
  return (
    <span className={METER_TONE[band]}>
      {args.short} {formatUtilization(utilization)}
    </span>
  )
}

function WindowLine(args: {
  label: string
  window: UsageWindowDto | null
  windowKind: EUsageWindow
  now: number
}) {
  const utilization = args.window?.utilization ?? null
  const band = meterBand({ utilization, warnAt: DEFAULT_WARN_PERCENT[args.windowKind] })
  const countdown = formatCountdown({ resetsAt: args.window?.resetsAt ?? null, now: args.now })
  return (
    <span className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{args.label}</span>
      <span className={`tabular-nums ${METER_TONE[band]}`}>
        {formatUtilization(utilization)}
        {countdown === '' ? '' : ` · resets in ${countdown}`}
      </span>
    </span>
  )
}

const labelOf = (report: UsageReportDto): string =>
  `Plan usage: 5-hour ${formatUtilization(report.fiveHour?.utilization ?? null)}, 7-day ${formatUtilization(report.sevenDay?.utilization ?? null)}`

export function SessionUsage(args: {
  model: SessionModelChoice | null | undefined
  working: boolean
}) {
  const provider = usageProviderOf(args.model)
  const turnEnds = useTurnEndCount(args.working)
  const { report } = useAccountUsage({
    input: provider === null ? null : { provider },
    turnEnds,
  })
  if (report === null || report.metered === false) return null
  const now = Date.now()
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={10}
        closeDelay={100}
        render={
          <Button variant="ghost" size="sm" className="tabular-nums" aria-label={labelOf(report)} />
        }
      >
        <WindowReading short="5h" window={report.fiveHour} windowKind={EUsageWindow.FiveHour} />
        <span className="text-muted-foreground"> · </span>
        <WindowReading short="7d" window={report.sevenDay} windowKind={EUsageWindow.SevenDay} />
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="flex w-60 flex-col gap-2 text-xs">
          <span className="text-sm font-medium">{report.label ?? 'Plan'}</span>
          <WindowLine
            label="5-hour"
            window={report.fiveHour}
            windowKind={EUsageWindow.FiveHour}
            now={now}
          />
          <WindowLine
            label="7-day"
            window={report.sevenDay}
            windowKind={EUsageWindow.SevenDay}
            now={now}
          />
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
