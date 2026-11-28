'use client'

import { ChartContainer, type ChartConfig } from '#components/chart'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Area, AreaChart, XAxis, YAxis } from 'recharts'

import {
  podSparkDiskOf,
  podSparkDomainOf,
  podSparkMarksPoints,
  podSparkNearest,
  podSparkTimeAt,
  podSparkTipOf,
  podSparkValuesOf,
  podSparkWindowOf,
  type PodSparkPoint,
} from './pod-spark-domain'

const COMBINED_CONFIG = {
  cpu: { label: 'CPU', color: 'var(--primary)' },
  ram: { label: 'RAM', color: 'var(--muted-foreground)' },
  disk: { label: 'Disk', color: 'var(--chart-2)' },
} satisfies ChartConfig

export interface PodUsageSparkProps {
  data: readonly PodSparkPoint[]
  limitGb: number
  defaultActiveIndex?: number | undefined
}

export function PodUsageSpark({ data, limitGb, defaultActiveIndex }: PodUsageSparkProps) {
  const [active, setActive] = useState<number | null>(defaultActiveIndex ?? null)
  const plot = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const withDisk = data.some((entry) => entry.disk !== undefined)
  const [from, to] = podSparkWindowOf({ samples: data })
  const marksPoints = podSparkMarksPoints(data)
  const [low, high] = podSparkDomainOf(podSparkValuesOf(data))
  const point = active === null ? null : (data[active] ?? null)

  useEffect(() => {
    if (active === null) return
    const handleOutside = (event: globalThis.PointerEvent) => {
      const element = plot.current
      if (element !== null && event.target instanceof Node && element.contains(event.target)) return
      setActive(null)
    }
    document.addEventListener('pointerdown', handleOutside, true)
    return () => document.removeEventListener('pointerdown', handleOutside, true)
  }, [active])

  const showAt = (clientX: number) => {
    const element = plot.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    const at = podSparkTimeAt({
      x: clientX - rect.left,
      width: rect.width,
      from,
      to,
    })
    const index = podSparkNearest({ samples: data, at })
    if (index !== null) setActive(index)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true
    showAt(event.clientX)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current && event.pointerType !== 'mouse') return
    showAt(event.clientX)
  }

  const handlePointerUp = () => {
    dragging.current = false
  }

  const handlePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false
    if (event.pointerType !== 'mouse') return
    setActive(null)
  }

  const tip =
    point === null
      ? null
      : podSparkTipOf({
          at: point.at,
          cpu: point.cpu,
          usedGb: point.ramGb,
          limitGb,
          disk: podSparkDiskOf(point),
        })

  return (
    <div className="relative h-8 w-full shrink-0 rounded-md border border-border bg-muted/30 p-1">
      <div
        ref={plot}
        data-slot="pod-spark-plot"
        className="h-full w-full touch-pan-y select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      >
        <ChartContainer
          config={COMBINED_CONFIG}
          className="aspect-auto h-full w-full"
          initialDimension={{ width: 278, height: 22 }}
          role="img"
          aria-label={
            withDisk
              ? 'CPU, RAM and disk over the last 15 minutes'
              : 'CPU and RAM over the last 15 minutes'
          }
        >
          <AreaChart data={[...data]} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <XAxis hide type="number" dataKey="at" domain={[from, to]} />
            <YAxis hide domain={[low, high]} />
            <YAxis hide yAxisId="disk" domain={[0, 100]} />
            {withDisk ? (
              <Area
                yAxisId="disk"
                dataKey="disk"
                type="monotone"
                stroke="var(--color-disk)"
                strokeWidth={1.25}
                fill="var(--color-disk)"
                fillOpacity={0.06}
                dot={marksPoints}
                isAnimationActive={false}
              />
            ) : null}
            <Area
              dataKey="ram"
              type="monotone"
              stroke="var(--color-ram)"
              strokeWidth={1.25}
              fill="var(--color-ram)"
              fillOpacity={0.08}
              dot={marksPoints}
              isAnimationActive={false}
            />
            <Area
              dataKey="cpu"
              type="monotone"
              stroke="var(--color-cpu)"
              strokeWidth={1.25}
              fill="var(--color-cpu)"
              fillOpacity={0.12}
              dot={marksPoints}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      </div>
      {tip === null ? null : (
        <div
          data-slot="pod-spark-tip"
          className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 flex -translate-x-1/2 flex-col gap-0.5 rounded-md border border-border bg-background px-1.5 py-1 text-[10px] leading-tight whitespace-nowrap shadow-md"
        >
          <span className="text-muted-foreground tabular-nums">{tip.time}</span>
          <span className="flex items-center gap-1 tabular-nums">
            <span aria-hidden className="size-1.5 rounded-[1px] bg-primary" />
            CPU {tip.cpu}
          </span>
          <span className="flex items-center gap-1 tabular-nums">
            <span aria-hidden className="size-1.5 rounded-[1px] bg-muted-foreground" />
            RAM {tip.ram}
          </span>
          {tip.disk === null ? null : (
            <span className="flex items-center gap-1 tabular-nums">
              <span aria-hidden className="size-1.5 rounded-[1px] bg-chart-2" />
              Disk {tip.disk}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
