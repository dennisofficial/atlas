'use client'

import { useMemo } from 'react'
import { CartesianGrid, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from 'recharts'

import { ChartContainer, ChartTooltip, type ChartConfig } from '@dltech/atlas-ui/components/chart'

import {
  buildBubblePoints,
  buildDayTicks,
  dayLabel,
  EUsageMetric,
  formatCost,
  RANGE_DAYS,
  type BubblePoint,
  type EUsageRange,
} from '../fixtures/settings-usage'

const CHART_CONFIG = {
  usage: { label: 'Usage', color: 'var(--chart-1)' },
} satisfies ChartConfig

const HOUR_TICKS = [0, 6, 12, 18, 23]

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

function isBubblePoint(value: unknown): value is BubblePoint {
  return typeof value === 'object' && value !== null && 'hour' in value && 'tokens' in value
}

type TooltipProps = {
  metric: EUsageMetric
  days: number
  active?: boolean
  payload?: readonly { payload?: unknown }[]
}

function BubbleTooltip({ metric, days, active, payload }: TooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || !isBubblePoint(point)) return null
  const value =
    metric === EUsageMetric.Tokens ? `${point.tokens.toFixed(2)}M tokens` : formatCost(point.cost)
  return (
    <div className="grid gap-0.5 rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      <span className="text-muted-foreground">
        {dayLabel(days - 1 - point.x)} · {formatHour(point.hour)}
      </span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  )
}

export function UsageBubbleChart({ metric, range }: { metric: EUsageMetric; range: EUsageRange }) {
  const days = RANGE_DAYS[range]
  const points = useMemo(() => buildBubblePoints(range), [range])
  const ticks = useMemo(() => buildDayTicks(range), [range])

  return (
    <ChartContainer config={CHART_CONFIG} className="aspect-auto h-64 w-full">
      <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="x"
          domain={[-0.5, days - 0.5]}
          ticks={ticks}
          tickFormatter={(x: number) => dayLabel(days - 1 - x)}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          type="number"
          dataKey="hour"
          domain={[-1, 24]}
          ticks={HOUR_TICKS}
          tickFormatter={formatHour}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <ZAxis type="number" dataKey={(point: BubblePoint) => point[metric]} range={[14, 240]} />
        <ChartTooltip cursor={false} content={<BubbleTooltip metric={metric} days={days} />} />
        <Scatter
          data={points}
          fill="var(--color-usage)"
          fillOpacity={0.55}
          isAnimationActive={false}
        />
      </ScatterChart>
    </ChartContainer>
  )
}
