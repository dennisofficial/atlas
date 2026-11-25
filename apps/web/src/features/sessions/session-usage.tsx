'use client'

import {
  DEFAULT_WARN_PERCENT,
  EAuthProvider,
  EUsageWindow,
  formatCountdown,
  formatUtilization,
  meterBand,
  parseRef,
  shownWindowsOf,
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

const WINDOW_SHORT: Record<EUsageWindow, string> = {
  [EUsageWindow.FiveHour]: '5h',
  [EUsageWindow.SevenDay]: '7d',
}

const WINDOW_LONG: Record<EUsageWindow, string> = {
  [EUsageWindow.FiveHour]: '5-hour',
  [EUsageWindow.SevenDay]: '7-day',
}

const labelOf = (args: { report: UsageReportDto; shown: readonly EUsageWindow[] }): string =>
  `Plan usage: ${args.shown
    .map((key) => `${WINDOW_LONG[key]} ${formatUtilization(args.report[key]?.utilization ?? null)}`)
    .join(', ')}`

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
  const shown = shownWindowsOf(report)
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={10}
        closeDelay={100}
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-sm font-bold tabular-nums"
            aria-label={labelOf({ report, shown })}
          />
        }
      >
        {shown.map((key, index) => (
          <span key={key}>
            {index === 0 ? null : <span className="text-muted-foreground"> · </span>}
            <WindowReading short={WINDOW_SHORT[key]} window={report[key]} windowKind={key} />
          </span>
        ))}
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="flex w-60 flex-col gap-2 text-xs">
          <span className="text-sm font-medium">{report.label ?? 'Plan'}</span>
          {shown.map((key) => (
            <WindowLine
              key={key}
              label={WINDOW_LONG[key]}
              window={report[key]}
              windowKind={key}
              now={now}
            />
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
