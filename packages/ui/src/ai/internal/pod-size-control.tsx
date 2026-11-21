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
  resizeError?: string | undefined
  disabled?: boolean | undefined
  defaultOpen?: boolean | undefined
  onResize?: ((shape: PodShape) => void) | undefined
}

export function PodSizeControl({
  shape,
  shapes,
  unavailable,
  pendingShape,
  resizeError,
  disabled = false,
  defaultOpen = false,
  onResize,
}: PodSizeControlProps) {
  const failed = resizeError !== undefined
  const options = podShapeOptionsOf({ shapes, unavailable, current: shape })

  const handleValueChange = (next: unknown) => {
    const picked = options.find((option) => option.key === next)
    if (picked === undefined || picked.disabled) return
    if (samePodShape({ a: picked.shape, b: shape })) return
    onResize?.(picked.shape)
  }

  const handleRetry = () => {
    if (pendingShape === undefined) return
    onResize?.(pendingShape)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] leading-4 text-muted-foreground">Size</span>
        <Select
          items={options.map((option) => ({ value: option.key, label: option.label }))}
          value={podShapeKey(shape)}
          defaultOpen={defaultOpen}
          onValueChange={handleValueChange}
          disabled={disabled}
        >
          <SelectTrigger size="sm" aria-label="Pod size" className="text-xs">
            {pendingShape === undefined ? null : <InlineSpinner />}
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
      </div>
      {failed ? (
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
      ) : null}
      {!failed && pendingShape !== undefined ? (
        <p className="text-[11px] leading-4 text-muted-foreground">
          Resizing to {podShapeLabel(pendingShape)} — the pod restarts
        </p>
      ) : null}
    </div>
  )
}
