import type { Meta, StoryObj } from '@storybook/react'
import { type ComponentType, useEffect, useState } from 'react'

import {
  PodMetricsCards,
  PodMetricsCombined,
  PodMetricsRows,
  type PodMetricsProps,
  type PodMetricsSample,
} from './pod-metrics'
import {
  nextPodSample,
  POD_SAMPLE_MS,
  POD_SERIES,
  POD_SIZES,
  POD_STATUS_RUNNING,
} from './pod-metrics.fixtures'

export enum EPodVariant {
  Rows = 'rows',
  Cards = 'cards',
  Combined = 'combined',
}

const VARIANTS: Record<EPodVariant, ComponentType<PodMetricsProps>> = {
  [EPodVariant.Rows]: PodMetricsRows,
  [EPodVariant.Cards]: PodMetricsCards,
  [EPodVariant.Combined]: PodMetricsCombined,
}

interface PodMetricsStoryArgs extends PodMetricsProps {
  variant: EPodVariant
  live: boolean
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 700))

function useLiveSeries({ initial, live }: { initial: readonly PodMetricsSample[]; live: boolean }) {
  const [series, setSeries] = useState(initial)
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => {
      setSeries((previous) => [...previous.slice(1), nextPodSample({ series: previous })])
    }, POD_SAMPLE_MS)
    return () => clearInterval(timer)
  }, [live])
  return series
}

function Stage({ variant, live, ...props }: PodMetricsStoryArgs) {
  const Section = VARIANTS[variant]
  const series = useLiveSeries({ initial: props.series, live })
  return (
    <div className="w-80 rounded-xl border border-border bg-background p-3">
      <div className="px-1 pb-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Pod</h3>
      </div>
      <Section {...props} series={series} />
    </div>
  )
}

const meta = {
  title: 'AI/Pod metrics',
  args: {
    variant: EPodVariant.Rows,
    live: false,
    status: POD_STATUS_RUNNING,
    sizes: POD_SIZES,
    series: POD_SERIES,
    throttled: false,
    oomKills: 0,
    onResize: settle,
    planCapHint: 'Hobby up to 4 vCPU · Pro up to 8 · Enterprise up to 32',
    settingsHref: '#',
  },
  parameters: { layout: 'centered' },
  render: (args) => <Stage {...args} />,
} satisfies Meta<PodMetricsStoryArgs>

export default meta

type Story = StoryObj<typeof meta>

export const VariantA: Story = {}

export const VariantB: Story = { args: { variant: EPodVariant.Cards } }

export const VariantC: Story = { args: { variant: EPodVariant.Combined } }

export const VariantALive: Story = { args: { variant: EPodVariant.Rows, live: true } }

export const VariantBLive: Story = { args: { variant: EPodVariant.Cards, live: true } }

export const VariantCLive: Story = { args: { variant: EPodVariant.Combined, live: true } }

export const VariantCSignals: Story = {
  args: { variant: EPodVariant.Combined, throttled: true, oomKills: 2 },
}
