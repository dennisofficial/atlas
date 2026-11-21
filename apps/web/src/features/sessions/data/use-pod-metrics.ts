'use client'

import { useEffect, useState } from 'react'

import { podMetricsFrameSchema } from '@dltech/atlas-protocol'

import { api } from '@/lib/api-client'

import { type PodMetricsSample, seriesAfter } from './pod-metrics-series'

const NONE: readonly PodMetricsSample[] = []

export function usePodMetrics(args: {
  sessionId: string
  enabled?: boolean
}): readonly PodMetricsSample[] {
  const { sessionId } = args
  const enabled = args.enabled ?? true
  const [series, setSeries] = useState<readonly PodMetricsSample[]>(NONE)
  useEffect(() => {
    setSeries(NONE)
    if (!enabled) return
    const subscription = api.sessions.podMetrics.subscribe(
      { sessionId },
      {
        onData: (value: unknown) => {
          const frame = podMetricsFrameSchema.safeParse(value)
          if (!frame.success) return
          setSeries((current) => seriesAfter({ series: current, frame: frame.data }))
        },
        onError: () => undefined,
      },
    )
    return () => subscription.unsubscribe()
  }, [enabled, sessionId])
  return enabled ? series : NONE
}
