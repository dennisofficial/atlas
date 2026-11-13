'use client'

import { cn } from 'cn'

import { InputGroupButton } from '#components/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '#components/popover'
import { Slider } from '#components/slider'

import { EFFORT_LABELS, type EEffort } from './model-selector-groups'

const GAUGE_CENTER_X = 12
const GAUGE_CENTER_Y = 12
const GAUGE_RADIUS = 9
const GAUGE_START_DEGREES = 135
const GAUGE_SWEEP_DEGREES = 270
const GAUGE_NEEDLE_RADIUS = 5.5
const THUMB_INSET_PX = 9

const round = (value: number): number => Math.round(value * 100) / 100

export function effortFraction({
  efforts,
  value,
}: {
  efforts: readonly EEffort[]
  value: EEffort
}): number {
  const last = efforts.length - 1
  const index = efforts.indexOf(value)
  if (last <= 0) return index < 0 ? 0 : 1
  return index < 0 ? 0 : index / last
}

const gaugePoint = ({
  fraction,
  radius = GAUGE_RADIUS,
}: {
  fraction: number
  radius?: number
}): readonly [number, number] => {
  const radians = ((GAUGE_START_DEGREES + GAUGE_SWEEP_DEGREES * fraction) * Math.PI) / 180
  return [GAUGE_CENTER_X + radius * Math.cos(radians), GAUGE_CENTER_Y + radius * Math.sin(radians)]
}

export function effortArc({ fraction }: { fraction: number }): string {
  const [fromX, fromY] = gaugePoint({ fraction: 0 })
  const [toX, toY] = gaugePoint({ fraction })
  const large = GAUGE_SWEEP_DEGREES * fraction > 180 ? 1 : 0
  return `M ${round(fromX)} ${round(fromY)} A ${GAUGE_RADIUS} ${GAUGE_RADIUS} 0 ${large} 1 ${round(toX)} ${round(toY)}`
}

export function effortNeedleDegrees({ fraction }: { fraction: number }): number {
  return round(-GAUGE_SWEEP_DEGREES / 2 + GAUGE_SWEEP_DEGREES * fraction)
}

const NEEDLE_PATH = `M ${GAUGE_CENTER_X} ${GAUGE_CENTER_Y} L ${GAUGE_CENTER_X} ${GAUGE_CENTER_Y - GAUGE_NEEDLE_RADIUS}`

export function EffortGauge({
  efforts,
  value,
  className,
}: {
  efforts: readonly EEffort[]
  value: EEffort
  className?: string
}) {
  const fraction = effortFraction({ efforts, value })
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden
      className={className}
    >
      <path d={effortArc({ fraction: 1 })} stroke="currentColor" />
      <g
        className="transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{
          transformBox: 'view-box',
          transformOrigin: `${GAUGE_CENTER_X}px ${GAUGE_CENTER_Y}px`,
          transform: `rotate(${effortNeedleDegrees({ fraction })}deg)`,
        }}
      >
        <path d={NEEDLE_PATH} stroke="currentColor" />
      </g>
    </svg>
  )
}

export const effortTickLeft = ({ index, last }: { index: number; last: number }): string =>
  last <= 0
    ? `${THUMB_INSET_PX}px`
    : `calc(${THUMB_INSET_PX}px + (100% - ${THUMB_INSET_PX * 2}px) * ${index / last})`

function EffortTicks({ efforts, index }: { efforts: readonly EEffort[]; index: number }) {
  const last = efforts.length - 1
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {efforts.map((effort, at) =>
        at === index ? null : (
          <span
            key={effort}
            className={cn(
              'absolute size-1 -translate-x-1/2 -translate-y-1/2 rounded-full',
              at < index ? 'bg-primary-foreground/60' : 'bg-muted-foreground/40',
            )}
            style={{ left: effortTickLeft({ index: at, last }), top: '50%' }}
          />
        ),
      )}
    </span>
  )
}

export function EffortDial({
  efforts,
  value,
  labels,
  note,
  showEffortLabel = false,
  onChange,
}: {
  efforts: readonly EEffort[]
  value: EEffort
  labels?: Partial<Record<EEffort, string>>
  note?: string
  showEffortLabel?: boolean
  onChange?: (effort: EEffort) => void
}) {
  const label = labels?.[value] ?? EFFORT_LABELS[value]
  const index = Math.max(0, efforts.indexOf(value))
  const last = efforts.length - 1
  const readOnly = onChange === undefined
  const handleValueChange = (next: number | readonly number[]) => {
    const picked = efforts[typeof next === 'number' ? next : (next[0] ?? 0)]
    if (picked !== undefined) onChange?.(picked)
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <InputGroupButton
            size="sm"
            data-slot="model-effort"
            data-read-only={readOnly ? '' : undefined}
            aria-label={`Effort: ${label}`}
            title={`Effort: ${label}`}
            className={readOnly ? 'text-muted-foreground' : undefined}
          />
        }
      >
        <EffortGauge efforts={efforts} value={value} className="size-5" />
        {showEffortLabel ? (
          <span className={cn('min-w-0 truncate text-xs', readOnly && 'text-muted-foreground')}>
            {label}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52">
        <div className="flex items-center gap-2">
          <EffortGauge
            efforts={efforts}
            value={value}
            className={cn('size-6 shrink-0', readOnly ? 'text-muted-foreground' : 'text-primary')}
          />
          <span
            className={cn(
              'min-w-0 truncate text-sm font-medium',
              readOnly ? 'text-muted-foreground' : 'text-primary',
            )}
          >
            {label}
          </span>
        </div>
        <div className="relative">
          <Slider
            aria-label="Effort"
            size="lg"
            min={0}
            max={last}
            step={1}
            value={[index]}
            disabled={readOnly}
            onValueChange={handleValueChange}
          />
          <EffortTicks efforts={efforts} index={index} />
        </div>
        {note === undefined ? null : <p className="text-xs text-muted-foreground">{note}</p>}
      </PopoverContent>
    </Popover>
  )
}
