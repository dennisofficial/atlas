'use client'

import { ChartContainer, type ChartConfig } from '#components/chart'
import { Area, AreaChart, YAxis } from 'recharts'

import {
  ESparkTone,
  MetricRow,
  MetricSignals,
  SeriesKey,
  Sparkline,
  UsageCard,
} from './internal/pod-metrics-parts'
import {
  gigabytes,
  podMetricViewOf,
  ramPercentOf,
  type PodMetricsSample,
} from './pod-metrics-model'
import { PodStatusChip } from './pod-status-chip'
import type { PodStatus } from './pod-status'

export { ESparkTone, Sparkline } from './internal/pod-metrics-parts'
export type { PodMetricsSample } from './pod-metrics-model'

export interface PodMetricsProps {
  status: PodStatus
  sizes: readonly number[]
  series: readonly PodMetricsSample[]
  throttled?: boolean | undefined
  oomKills?: number | undefined
  onResize?: ((vcpus: number) => Promise<void>) | undefined
  planCapHint?: string | undefined
  settingsHref?: string | undefined
}

const WINDOW_LABEL = 'Last 15 min, every 3 s'

const COMBINED_CONFIG = {
  cpu: { label: 'CPU', color: 'var(--primary)' },
  ram: { label: 'RAM', color: 'var(--muted-foreground)' },
} satisfies ChartConfig

function sizeControlOf(props: PodMetricsProps) {
  return (
    <PodStatusChip
      status={props.status}
      sizes={props.sizes}
      onResize={props.onResize}
      planCapHint={props.planCapHint}
      settingsHref={props.settingsHref}
    />
  )
}

export function PodMetricsRows(props: PodMetricsProps) {
  const view = podMetricViewOf({ series: props.series, vcpus: props.status.vcpus })
  return (
    <section aria-label="Pod usage" className="flex flex-col gap-1">
      <MetricRow label="CPU" value={view.cpuLabel}>
        <Sparkline
          values={view.cpuValues}
          domain={[0, 100]}
          tone={ESparkTone.Accent}
          label="CPU over the last 15 minutes"
        />
      </MetricRow>
      <MetricRow label="RAM" value={view.ramLabel}>
        <Sparkline
          values={view.ramValues}
          domain={[0, view.ramLimitGb]}
          tone={ESparkTone.Muted}
          label="RAM over the last 15 minutes"
        />
      </MetricRow>
      <div className="flex items-center gap-2 px-1 pt-0.5">
        <MetricSignals throttled={props.throttled === true} oomKills={props.oomKills ?? 0} />
        <span className="ml-auto flex">{sizeControlOf(props)}</span>
      </div>
    </section>
  )
}

export function PodMetricsCards(props: PodMetricsProps) {
  const view = podMetricViewOf({ series: props.series, vcpus: props.status.vcpus })
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <UsageCard label="CPU" value={view.cpuLabel} caption={`of ${view.vcpus} vCPU`}>
          <Sparkline
            values={view.cpuValues}
            domain={[0, 100]}
            tone={ESparkTone.Accent}
            label="CPU over the last 15 minutes"
          />
        </UsageCard>
        <UsageCard
          label="RAM"
          value={gigabytes(view.ramGb)}
          caption={`of ${gigabytes(view.ramLimitGb)} GB`}
        >
          <Sparkline
            values={view.ramValues}
            domain={[0, view.ramLimitGb]}
            tone={ESparkTone.Muted}
            label="RAM over the last 15 minutes"
          />
        </UsageCard>
      </div>
      <div className="flex items-center gap-2 px-1">
        <MetricSignals throttled={props.throttled === true} oomKills={props.oomKills ?? 0} />
        <span className="ml-auto flex">{sizeControlOf(props)}</span>
      </div>
    </div>
  )
}

export function PodMetricsCombined(props: PodMetricsProps) {
  const view = podMetricViewOf({ series: props.series, vcpus: props.status.vcpus })
  const data = props.series.map((sample, index) => ({
    index,
    cpu: sample.cpu,
    ram: ramPercentOf({ sample, limitGb: view.ramLimitGb }),
  }))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 flex-col gap-0.5 text-xs">
          <SeriesKey label="CPU" value={view.cpuLabel} swatch="bg-primary" />
          <SeriesKey label="RAM" value={view.ramLabel} swatch="bg-muted-foreground" />
        </div>
        <span className="flex shrink-0">{sizeControlOf(props)}</span>
      </div>
      <div className="h-20">
        <ChartContainer
          config={COMBINED_CONFIG}
          className="aspect-auto h-full w-full"
          initialDimension={{ width: 296, height: 80 }}
          role="img"
          aria-label="CPU and RAM over the last 15 minutes"
        >
          <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <YAxis hide domain={[0, 100]} />
            <Area
              dataKey="ram"
              type="monotone"
              stroke="var(--color-ram)"
              strokeWidth={1.5}
              fill="var(--color-ram)"
              fillOpacity={0.06}
              dot={false}
              isAnimationActive={false}
            />
            <Area
              dataKey="cpu"
              type="monotone"
              stroke="var(--color-cpu)"
              strokeWidth={1.5}
              fill="var(--color-cpu)"
              fillOpacity={0.1}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
        <span>{WINDOW_LABEL}</span>
        <MetricSignals throttled={props.throttled === true} oomKills={props.oomKills ?? 0} />
      </div>
    </div>
  )
}
