'use client'

import { AlertDialog } from '#components/alert-dialog'
import { MoonIcon } from 'lucide-react'

import { PodDiskSelect } from './internal/pod-disk-control'
import { EPodAction, PodActionConfirm } from './internal/pod-action-confirm'
import { MetricSignals } from './internal/pod-metrics-parts'
import { PodSectionHeader } from './internal/pod-section-header'
import { PodSizeSelect, PodSizeStatus, type PodSizeControlProps } from './internal/pod-size-control'
import { PodUsageSpark } from './internal/pod-spark'
import {
  commandMemorySuffix,
  diskPercentOf,
  formatRam,
  gigabytes,
  podDiskOf,
  podMetricViewOf,
  ramPercentOf,
  type PodMetricsSample,
} from './pod-metrics-model'
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
  usageUnavailable?: boolean | undefined
  pendingShape?: PodShape | undefined
  resizeWaiting?: boolean | undefined
  resizeError?: string | undefined
  throttled?: boolean | undefined
  oomKills?: number | undefined
  oomEvents?: number | undefined
  commandRamLimitGb?: number | undefined
  diskLimitGb?: number | undefined
  starting?: boolean | undefined
  stopping?: boolean | undefined
  message?: string | undefined
  confirmAction?: EPodAction | undefined
  defaultActiveIndex?: number | undefined
  sizeMenuOpen?: boolean | undefined
  onSizeMenuOpenChange?: ((open: boolean) => void) | undefined
  onStart?: (() => void) | undefined
  onStop?: (() => void) | undefined
  onResize?: ((shape: PodShape) => void) | undefined
  onResizeNow?: (() => Promise<void>) | undefined
  onCancelResize?: (() => Promise<void>) | undefined
  diskGrow?: boolean | undefined
  onGrowDisk?: ((diskGb: number) => void) | undefined
  onConfirm?: (() => void) | undefined
  onCancel?: (() => void) | undefined
}

const IDLE_TEXT: Record<EPodState, string> = {
  [EPodState.Starting]: 'Starting',
  [EPodState.Running]: 'No samples',
  [EPodState.Resuming]: 'Starting',
  [EPodState.Parked]: 'Asleep',
  [EPodState.Stopped]: 'Stopped',
}

function PodSeriesRow({
  label,
  value,
  swatch,
  row,
}: {
  label: string
  value: string
  swatch: string
  row: string
}) {
  return (
    <>
      <span className={`col-start-1 ${row} flex justify-center`}>
        <span className={`size-2 rounded-[2px] ${swatch}`} />
      </span>
      <span className={`col-start-2 ${row} flex min-w-0 items-center gap-1.5`}>
        <span className="text-muted-foreground">{label}</span>
        <span className="truncate tabular-nums">{value}</span>
      </span>
    </>
  )
}

function PodUsageIdle({ state, unavailable }: { state: EPodState; unavailable: boolean }) {
  if (unavailable)
    return (
      <div
        role="img"
        aria-label="Usage unavailable"
        className="flex h-10 w-28 items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground"
      >
        Usage unavailable
      </div>
    )
  return (
    <div
      role="img"
      aria-label={
        state === EPodState.Running
          ? 'No live usage yet'
          : `No live usage — pod ${IDLE_TEXT[state].toLowerCase()}`
      }
      className="flex h-10 w-28 items-center justify-center gap-1 rounded-md border border-dashed border-border text-[11px] text-muted-foreground"
    >
      <MoonIcon aria-hidden className="size-3" />
      {IDLE_TEXT[state]}
    </div>
  )
}

function diskValueOf({
  disk,
  limitGb,
  running,
}: {
  disk: { usedGb: number; limitGb: number } | undefined
  limitGb: number | undefined
  running: boolean
}): string {
  if (disk === undefined) return limitGb === undefined ? '—' : `— / ${gigabytes(limitGb)} GB`
  if (!running) return `— / ${gigabytes(disk.limitGb)} GB`
  return formatRam(disk)
}

export function PodSection(props: PodSectionProps) {
  const view = podMetricViewOf({
    series: props.series,
    vcpus: props.shape.vcpus,
    ramLimitGb: props.shape.memoryGb,
  })
  const running = props.state === EPodState.Running
  const disk = podDiskOf(props.series)
  const data = props.series.map((sample) => ({
    at: sample.t,
    cpu: sample.cpu,
    ram: ramPercentOf({ sample, limitGb: view.ramLimitGb }),
    ramGb: sample.ramGb,
    disk: sample.diskUsedGb === undefined ? undefined : diskPercentOf({ sample }),
    diskUsedGb: sample.diskUsedGb,
    diskLimitGb: sample.diskLimitGb,
  }))

  const sizeProps: PodSizeControlProps = {
    shape: props.shape,
    shapes: props.shapes,
    unavailable: props.unavailable,
    pendingShape: props.pendingShape,
    resizeWaiting: props.resizeWaiting === true,
    resizeError: props.resizeError,
    disabled:
      !canResize(props.state) || props.stopping === true || props.pendingShape !== undefined,
    defaultOpen: props.defaultSizeMenuOpen === true,
    open: props.sizeMenuOpen,
    onOpenChange: props.onSizeMenuOpenChange,
    onResize: props.onResize,
    onResizeNow: props.onResizeNow,
    onCancelResize: props.onCancelResize,
  }

  const ramValue = running ? view.ramLabel : `— / ${view.ramLimitGb} GB`
  const diskLimitGb = disk?.limitGb ?? props.diskLimitGb
  const diskValue = diskValueOf({ disk, limitGb: diskLimitGb, running })
  const sampling = running && props.usageUnavailable !== true && props.series.length > 0
  const diskGrow = props.diskGrow === true

  return (
    <div className="flex flex-col gap-2">
      <PodSectionHeader
        state={props.state}
        starting={props.starting === true}
        stopping={props.stopping === true}
        resizing={props.pendingShape !== undefined && props.resizeError === undefined}
        waiting={props.resizeWaiting === true}
        sizeControl={<PodSizeSelect {...sizeProps} />}
        onStart={props.onStart}
        onStop={props.onStop}
      />
      {props.message === undefined ? null : (
        <p className="text-xs text-muted-foreground">{props.message}</p>
      )}
      <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 text-xs">
        <PodSeriesRow
          label="CPU"
          value={running ? view.cpuLabel : '—'}
          swatch="bg-primary"
          row="row-start-1"
        />
        <PodSeriesRow
          label="RAM"
          value={`${ramValue}${commandMemorySuffix(props.commandRamLimitGb)}`}
          swatch="bg-muted-foreground"
          row="row-start-2"
        />
        <PodSeriesRow label="Disk" value={diskValue} swatch="bg-chart-2" row="row-start-3" />
        <div
          className={`col-start-3 row-start-1 flex items-center self-stretch ${
            diskGrow ? 'row-span-2' : 'row-span-3'
          }`}
        >
          {sampling ? (
            <PodUsageSpark
              data={data}
              limitGb={view.ramLimitGb}
              defaultActiveIndex={props.defaultActiveIndex}
            />
          ) : (
            <PodUsageIdle state={props.state} unavailable={props.usageUnavailable === true} />
          )}
        </div>
        {diskGrow ? (
          <div className="col-start-3 row-start-3 flex justify-end">
            <PodDiskSelect
              limitGb={diskLimitGb}
              disabled={sizeProps.disabled}
              onGrow={props.onGrowDisk}
            />
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 pl-[1.625rem]">
        <MetricSignals
          throttled={props.throttled === true}
          oomEvents={props.oomEvents}
          oomKills={props.oomKills ?? 0}
        />
        <PodSizeStatus {...sizeProps} />
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
