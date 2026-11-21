'use client'

import { AlertDialog } from '#components/alert-dialog'
import { ChartContainer, type ChartConfig } from '#components/chart'
import { Area, AreaChart, YAxis } from 'recharts'

import { EPodAction, PodActionConfirm } from './internal/pod-action-confirm'
import { SeriesKey, MetricSignals } from './internal/pod-metrics-parts'
import { PodSectionHeader } from './internal/pod-section-header'
import { PodSizeControl } from './internal/pod-size-control'
import { podMetricViewOf, ramPercentOf, type PodMetricsSample } from './pod-metrics-model'
import type { PodShape, UnavailablePodShape } from './pod-shapes'
import { canResize, EPodState } from './pod-status'

export { EPodAction } from './internal/pod-action-confirm'
export type { PodMetricsSample } from './pod-metrics-model'
export type { PodShape, UnavailablePodShape } from './pod-shapes'

export interface PodSectionProps {
  defaultSizeMenuOpen?: boolean | undefined
  state: EPodState
  shape: PodShape
  shapes: readonly PodShape[]
  unavailable?: readonly UnavailablePodShape[] | undefined
  series: readonly PodMetricsSample[]
  pendingShape?: PodShape | undefined
  resizeError?: string | undefined
  throttled?: boolean | undefined
  oomKills?: number | undefined
  stopping?: boolean | undefined
  confirmAction?: EPodAction | undefined
  onStart?: (() => void) | undefined
  onStop?: (() => void) | undefined
  onResize?: ((shape: PodShape) => void) | undefined
  onConfirm?: (() => void) | undefined
  onCancel?: (() => void) | undefined
}

const COMBINED_CONFIG = {
  cpu: { label: 'CPU', color: 'var(--primary)' },
  ram: { label: 'RAM', color: 'var(--muted-foreground)' },
} satisfies ChartConfig

const QUIET_TEXT: Record<EPodState, string> = {
  [EPodState.Starting]: 'Starting the pod — usage appears once it is up',
  [EPodState.Running]: 'Waiting for the first sample',
  [EPodState.Resuming]: 'Starting the pod — usage appears once it is up',
  [EPodState.Parked]: 'Pod is asleep — start it to see live usage',
  [EPodState.Stopped]: 'Pod is stopped — start it to see live usage',
}

function PodUsageSpark({ data }: { data: { index: number; cpu: number; ram: number }[] }) {
  return (
    <div className="h-9 w-28 shrink-0">
      <ChartContainer
        config={COMBINED_CONFIG}
        className="aspect-auto h-full w-full"
        initialDimension={{ width: 112, height: 36 }}
        role="img"
        aria-label="CPU and RAM over the last 15 minutes"
      >
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <YAxis hide domain={[0, 100]} />
          <Area
            dataKey="ram"
            type="monotone"
            stroke="var(--color-ram)"
            strokeWidth={1.25}
            fill="var(--color-ram)"
            fillOpacity={0.06}
            dot={false}
            isAnimationActive={false}
          />
          <Area
            dataKey="cpu"
            type="monotone"
            stroke="var(--color-cpu)"
            strokeWidth={1.25}
            fill="var(--color-cpu)"
            fillOpacity={0.1}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  )
}

export function PodSection(props: PodSectionProps) {
  const view = podMetricViewOf({
    series: props.series,
    vcpus: props.shape.vcpus,
    ramLimitGb: props.shape.memoryGb,
  })
  const running = props.state === EPodState.Running
  const data = props.series.map((sample, index) => ({
    index,
    cpu: sample.cpu,
    ram: ramPercentOf({ sample, limitGb: view.ramLimitGb }),
  }))

  return (
    <div className="flex flex-col gap-2">
      <PodSectionHeader
        state={props.state}
        stopping={props.stopping === true}
        resizing={props.pendingShape !== undefined && props.resizeError === undefined}
        onStart={props.onStart}
        onStop={props.onStop}
      />
      <div className="flex flex-col gap-2 pl-[1.625rem]">
        {running ? (
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
              <SeriesKey label="CPU" value={view.cpuLabel} swatch="bg-primary" />
              <SeriesKey label="RAM" value={view.ramLabel} swatch="bg-muted-foreground" />
            </div>
            <PodUsageSpark data={data} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{QUIET_TEXT[props.state]}</p>
        )}
        <MetricSignals throttled={props.throttled === true} oomKills={props.oomKills ?? 0} />
        <PodSizeControl
          shape={props.shape}
          shapes={props.shapes}
          unavailable={props.unavailable}
          pendingShape={props.pendingShape}
          resizeError={props.resizeError}
          disabled={
            !canResize(props.state) || props.stopping === true || props.pendingShape !== undefined
          }
          defaultOpen={props.defaultSizeMenuOpen === true}
          onResize={props.onResize}
        />
      </div>
      {props.confirmAction === undefined ? null : (
        <AlertDialog open>
          <PodActionConfirm
            action={props.confirmAction}
            onConfirm={props.onConfirm}
            onCancel={props.onCancel}
          />
        </AlertDialog>
      )}
    </div>
  )
}
