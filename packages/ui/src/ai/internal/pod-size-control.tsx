'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#components/select'
import { TriangleAlertIcon } from 'lucide-react'

import {
  type PodShape,
  podShapeKey,
  podShapeLabel,
  samePodShape,
  type UnavailablePodShape,
} from '../pod-shapes'
import { InlineSpinner } from './status-dot'
import { PodResizeWait } from './pod-resize-wait'

export interface PodShapeOption {
  key: string
  label: string
  shape: PodShape
  disabled: boolean
  reason?: string | undefined
}

export function podShapeOptionsOf({
  shapes,
  unavailable = [],
  current,
}: {
  shapes: readonly PodShape[]
  unavailable?: readonly UnavailablePodShape[] | undefined
  current: PodShape
}): PodShapeOption[] {
  const currentKey = podShapeKey(current)
  const reasons = new Map(unavailable.map((entry) => [podShapeKey(entry.shape), entry.reason]))
  const offered = shapes.some((shape) => samePodShape({ a: shape, b: current }))
    ? [...shapes]
    : [...shapes, current]
  const offeredKeys = new Set(offered.map(podShapeKey))
  return [
    ...offered.map((shape) => {
      const key = podShapeKey(shape)
      const reason = key === currentKey ? undefined : reasons.get(key)
      return {
        key,
        label: podShapeLabel(shape),
        shape,
        disabled: reason !== undefined,
        reason,
      }
    }),
    ...unavailable
      .filter((entry) => !offeredKeys.has(podShapeKey(entry.shape)))
      .map((entry) => ({
        key: podShapeKey(entry.shape),
        label: podShapeLabel(entry.shape),
        shape: entry.shape,
        disabled: true,
        reason: entry.reason,
      })),
  ]
}

export interface PodSizeControlProps {
  shape: PodShape
  shapes: readonly PodShape[]
  unavailable?: readonly UnavailablePodShape[] | undefined
  pendingShape?: PodShape | undefined
  resizeWaiting?: boolean | undefined
  resizeError?: string | undefined
  disabled?: boolean | undefined
  defaultOpen?: boolean | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
  onResize?: ((shape: PodShape) => void) | undefined
  onResizeNow?: (() => Promise<void>) | undefined
  onCancelResize?: (() => Promise<void>) | undefined
}

function podSizeOptionsOf(props: PodSizeControlProps): PodShapeOption[] {
  const pending = props.pendingShape
  const shapes =
    pending === undefined || props.shapes.some((shape) => samePodShape({ a: shape, b: pending }))
      ? props.shapes
      : [...props.shapes, pending]
  return podShapeOptionsOf({ shapes, unavailable: props.unavailable, current: props.shape })
}

export function PodSizeSelect(props: PodSizeControlProps) {
  const options = podSizeOptionsOf(props)

  const handleValueChange = (next: unknown) => {
    const picked = options.find((option) => option.key === next)
    if (picked === undefined || picked.disabled) return
    if (samePodShape({ a: picked.shape, b: props.shape })) return
    props.onResize?.(picked.shape)
  }

  return (
    <Select
      items={options.map((option) => ({ value: option.key, label: option.label }))}
      value={podShapeKey(props.pendingShape ?? props.shape)}
      defaultOpen={props.open === undefined ? props.defaultOpen === true : undefined}
      open={props.open}
      onOpenChange={props.onOpenChange}
      onValueChange={handleValueChange}
      disabled={props.disabled === true}
    >
      <SelectTrigger size="sm" aria-label="Pod size" className="text-xs">
        {props.pendingShape === undefined ? null : <InlineSpinner />}
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="w-auto min-w-(--anchor-width)">
        {options.map((option) => (
          <SelectItem key={option.key} value={option.key} disabled={option.disabled}>
            <span className="flex flex-col">
              <span className="whitespace-nowrap">{option.label}</span>
              {option.reason === undefined ? null : (
                <span className="text-xs text-muted-foreground">{option.reason}</span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function PodSizeStatus({
  pendingShape,
  resizeWaiting,
  resizeError,
  onResize,
  onResizeNow,
  onCancelResize,
}: PodSizeControlProps) {
  const handleRetry = () => {
    if (pendingShape === undefined) return
    onResize?.(pendingShape)
  }

  if (resizeError !== undefined) {
    return (
      <p className="flex items-start gap-1 text-xs text-destructive">
        <TriangleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0" />
        <span className="min-w-0 flex-1">
          Could not resize the pod.{resizeError === '' ? '' : ` ${resizeError}`}{' '}
          <button
            type="button"
            onClick={handleRetry}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Retry
          </button>
        </span>
      </p>
    )
  }
  if (resizeWaiting !== true || pendingShape === undefined) return null
  return (
    <PodResizeWait
      pendingShape={pendingShape}
      onResizeNow={onResizeNow}
      onCancelResize={onCancelResize}
    />
  )
}
