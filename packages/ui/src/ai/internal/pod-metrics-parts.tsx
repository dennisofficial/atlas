'use client'

import { Card } from '#components/card'
import { ChartContainer, type ChartConfig } from '#components/chart'
import { cn } from '#lib/utils'
import { TriangleAlertIcon, ZapIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Area, AreaChart, YAxis } from 'recharts'

export enum ESparkTone {
  Accent = 'accent',
  Muted = 'muted',
  Danger = 'danger',
}

const TONE_COLOR: Record<ESparkTone, string> = {
  [ESparkTone.Accent]: 'var(--primary)',
  [ESparkTone.Muted]: 'var(--muted-foreground)',
  [ESparkTone.Danger]: 'var(--destructive)',
}

const TONE_FILL: Record<ESparkTone, number> = {
  [ESparkTone.Accent]: 0.18,
  [ESparkTone.Muted]: 0.12,
  [ESparkTone.Danger]: 0.18,
}

export interface SparklineProps {
  values: readonly number[]
  domain: readonly [number, number]
  label: string
  tone?: ESparkTone
}

export function Sparkline({ values, domain, label, tone = ESparkTone.Accent }: SparklineProps) {
  const config = { value: { label, color: TONE_COLOR[tone] } } satisfies ChartConfig
  const data = values.map((value, index) => ({ index, value }))
  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-full w-full"
      initialDimension={{ width: 96, height: 24 }}
      role="img"
      aria-label={label}
    >
      <AreaChart data={data} margin={{ top: 1, right: 0, bottom: 1, left: 0 }}>
        <YAxis hide domain={[domain[0], domain[1]]} />
        <Area
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={1.5}
          fill="var(--color-value)"
          fillOpacity={TONE_FILL[tone]}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}

export function MetricRow({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="w-8 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm tabular-nums">{value}</span>
      <div className="h-6 w-24 shrink-0">{children}</div>
    </div>
  )
}

export function UsageCard({
  label,
  value,
  caption,
  children,
}: {
  label: string
  value: string
  caption: string
  children: ReactNode
}) {
  return (
    <Card size="sm" className="min-w-0">
      <div className="flex flex-col gap-1 px-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xl leading-none font-medium tabular-nums">{value}</span>
        <span className="truncate text-xs text-muted-foreground">{caption}</span>
        <div className="h-10">{children}</div>
      </div>
    </Card>
  )
}

export function SeriesKey({
  label,
  value,
  swatch,
}: {
  label: string
  value: string
  swatch: string
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('size-2 shrink-0 rounded-[2px]', swatch)} />
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  )
}

export function MetricSignals({ throttled, oomKills }: { throttled: boolean; oomKills: number }) {
  if (!throttled && oomKills === 0) return null
  return (
    <span className="flex items-center gap-2.5 text-[11px] leading-4">
      {throttled ? (
        <span className="flex items-center gap-1 text-warning">
          <ZapIcon aria-hidden className="size-3" />
          Throttled
        </span>
      ) : null}
      {oomKills > 0 ? (
        <span className="flex items-center gap-1 text-destructive">
          <TriangleAlertIcon aria-hidden className="size-3" />
          {oomKills === 1 ? '1 OOM kill' : `${oomKills} OOM kills`}
        </span>
      ) : null}
    </span>
  )
}
