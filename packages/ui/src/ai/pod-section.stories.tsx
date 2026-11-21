import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'

import { EPodAction, PodSection, type PodSectionProps, type PodMetricsSample } from './pod-section'
import { clamp } from './pod-metrics-model'
import {
  nextPodSample,
  POD_SAMPLE_MS,
  POD_SECTION_SHAPES,
  VERCEL_HOBBY_UNAVAILABLE,
  VERCEL_PLAN_CAP_SHAPES,
  VERCEL_PRO_SHAPE,
  VERCEL_PRO_SHAPES,
} from './pod-metrics.fixtures'
import { EPodState } from './pod-status'

const SERIES_END_AT = Date.parse('2026-11-21T14:41:00Z')

function storySeriesOf({
  samples,
  spikeAt,
}: {
  samples: number
  spikeAt: number
}): readonly PodMetricsSample[] {
  const start = SERIES_END_AT - (samples - 1) * POD_SAMPLE_MS
  return Array.from({ length: samples }, (_, index) => {
    const spike = index === spikeAt ? 1 : 0
    return {
      t: start + index * POD_SAMPLE_MS,
      cpu: clamp({
        value: 9 + 4 * Math.sin(index / 3.5) + 1.6 * Math.sin(index / 1.3) + spike * 26,
        min: 3,
        max: 95,
      }),
      ramGb: clamp({
        value: 1.7 + 0.05 * Math.sin(index / 9) + 0.012 * Math.sin(index / 2.2) + spike * 0.1,
        min: 1.62,
        max: 1.86,
      }),
    }
  })
}

const STORY_SHAPE = { vcpus: 4, memoryGb: 8 }

const RUNNING_SERIES = storySeriesOf({ samples: 300, spikeAt: 220 })
const RECENT_SERIES = storySeriesOf({ samples: 100, spikeAt: 62 })
const FRESH_SERIES = storySeriesOf({ samples: 20, spikeAt: 14 })

interface PodSectionStoryArgs extends PodSectionProps {
  live: boolean
}

function useLiveSeries({
  initial,
  live,
}: {
  initial: readonly PodMetricsSample[]
  live: boolean
}): readonly PodMetricsSample[] {
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

function Stage({ live, ...props }: PodSectionStoryArgs) {
  const series = useLiveSeries({ initial: props.series, live })
  return (
    <div className="w-80 rounded-xl border border-border bg-background p-3">
      <PodSection {...props} series={series} />
    </div>
  )
}

const meta = {
  title: 'AI/Pod section',
  args: {
    live: false,
    state: EPodState.Running,
    shape: STORY_SHAPE,
    shapes: POD_SECTION_SHAPES,
    series: RUNNING_SERIES,
    throttled: false,
    oomKills: 0,
    onStart: () => {},
    onStop: () => {},
    onResize: () => {},
  },
  parameters: { layout: 'centered' },
  render: (args) => <Stage {...args} />,
} satisfies Meta<PodSectionStoryArgs>

export default meta

type Story = StoryObj<typeof meta>

export const Running: Story = {}

export const Recent: Story = { args: { series: RECENT_SERIES } }

export const FreshPod: Story = { args: { series: FRESH_SERIES } }

export const TooltipOpen: Story = { args: { defaultActiveIndex: 220 } }

export const RunningLive: Story = { args: { live: true } }

export const Throttled: Story = { args: { throttled: true, oomKills: 2 } }

export const Resizing: Story = { args: { pendingShape: { vcpus: 8, memoryGb: 64 } } }

export const ResizeFailed: Story = {
  args: {
    pendingShape: { vcpus: 8, memoryGb: 64 },
    resizeError: 'The pod did not come back in time',
  },
}

export const HobbyCap: Story = {
  args: {
    shape: VERCEL_PRO_SHAPE,
    shapes: VERCEL_PRO_SHAPES,
    unavailable: VERCEL_HOBBY_UNAVAILABLE,
  },
}

export const Sleeping: Story = { args: { state: EPodState.Parked } }

export const Stopped: Story = { args: { state: EPodState.Stopped } }

export const Starting: Story = { args: { state: EPodState.Starting } }

export const StopConfirm: Story = { args: { confirmAction: EPodAction.Stop } }

export const SizeMenuOpenAgent37: Story = { args: { defaultSizeMenuOpen: true } }

export const SizeMenuOpenVercelHobby: Story = {
  args: {
    shape: VERCEL_PRO_SHAPE,
    shapes: VERCEL_PRO_SHAPES,
    unavailable: VERCEL_HOBBY_UNAVAILABLE,
    defaultSizeMenuOpen: true,
  },
}

export const SizeMenuOpenVercelPro: Story = {
  args: {
    shape: { vcpus: 2, memoryGb: 4 },
    shapes: VERCEL_PRO_SHAPES,
    defaultSizeMenuOpen: true,
  },
}

export const SizeMenuOpenEnterprise: Story = {
  args: {
    shape: VERCEL_PRO_SHAPE,
    shapes: VERCEL_PLAN_CAP_SHAPES,
    defaultSizeMenuOpen: true,
  },
}
