'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '#components/tooltip'
import { cn } from '#lib/utils'
import { TriangleAlertIcon } from 'lucide-react'

import { ramOf } from '../pod-status'
import { InlineSpinner } from './status-dot'

export interface PodSizeControlProps {
  vcpus: number
  sizes: readonly number[]
  maxVcpus: number
  pendingVcpus?: number | undefined
  resizeError?: string | undefined
  disabled?: boolean | undefined
  onResize?: ((vcpus: number) => void) | undefined
}

export function planCapHintOf({ size, maxVcpus }: { size: number; maxVcpus: number }): string {
  return `${size} vCPU is above your plan limit of ${maxVcpus}`
}

interface SegmentProps {
  size: number
  maxVcpus: number
  selected: boolean
  pending: boolean
  capped: boolean
  locked: boolean
  onPick: (size: number) => void
}

function Segment({ size, maxVcpus, selected, pending, capped, locked, onPick }: SegmentProps) {
  const handleClick = () => {
    if (locked) return
    onPick(size)
  }
  const segment = (
    <button
      type="button"
      aria-pressed={selected}
      aria-disabled={locked}
      onClick={handleClick}
      className={cn(
        'flex min-w-0 flex-col items-center rounded-md px-1 py-1 text-center transition-colors',
        selected
          ? 'bg-background text-foreground ring-1 ring-border'
          : 'text-muted-foreground hover:text-foreground',
        locked && 'cursor-not-allowed opacity-45 hover:text-muted-foreground',
      )}
    >
      <span className="flex items-center gap-1 text-xs font-medium whitespace-nowrap tabular-nums">
        {pending ? <InlineSpinner /> : null}
        {size} vCPU
      </span>
      <span className="text-[0.65rem] leading-tight whitespace-nowrap tabular-nums">
        {ramOf(size)} GB
      </span>
    </button>
  )
  if (!capped) return segment
  return (
    <Tooltip>
      <TooltipTrigger render={segment} />
      <TooltipContent>{planCapHintOf({ size, maxVcpus })}</TooltipContent>
    </Tooltip>
  )
}

export function PodSizeControl({
  vcpus,
  sizes,
  maxVcpus,
  pendingVcpus,
  resizeError,
  disabled = false,
  onResize,
}: PodSizeControlProps) {
  const pending = pendingVcpus
  const failed = resizeError !== undefined

  const handlePick = (size: number) => {
    if (size === vcpus || size === pending) return
    onResize?.(size)
  }

  const handleRetry = () => {
    if (pending === undefined) return
    onResize?.(pending)
  }

  return (
    <div className="flex flex-col gap-1.5 px-1">
      <fieldset
        aria-label="Pod size"
        className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(4rem,1fr))] gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
      >
        {sizes.map((size) => (
          <Segment
            key={size}
            size={size}
            maxVcpus={maxVcpus}
            selected={size === vcpus}
            pending={size === pending && !failed}
            capped={size > maxVcpus}
            locked={disabled || size > maxVcpus}
            onPick={handlePick}
          />
        ))}
      </fieldset>
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
      {!failed && pending !== undefined ? (
        <p className="text-xs text-muted-foreground">
          Resizing to {pending} vCPU — the pod restarts
        </p>
      ) : null}
      {!failed && pending === undefined ? (
        <p className="text-xs text-muted-foreground">2 GB per vCPU — RAM moves with the CPU.</p>
      ) : null}
    </div>
  )
}
