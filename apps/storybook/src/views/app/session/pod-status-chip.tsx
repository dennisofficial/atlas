import { useEffect, useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@dltech/atlas-ui/components/popover'
import { Spinner } from '@dltech/atlas-ui/components/spinner'
import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'
import { cn } from '@dltech/atlas-ui/lib/utils'

import {
  canResize,
  chipLabel,
  EPodState,
  ramOf,
  sizeLabel,
  STATE_LABEL,
  VCPU_STEPS,
  type PodChipConfig,
  type PodStatus,
} from './pod-status'
import { StatusDot } from './status-dot'
import { EDotTone } from './session-types'

const APPLY_DELAY_MS = 700

const DOT_TONE: Record<EPodState, EDotTone> = {
  [EPodState.Starting]: EDotTone.Pending,
  [EPodState.Running]: EDotTone.Live,
  [EPodState.Resuming]: EDotTone.Pending,
  [EPodState.Parked]: EDotTone.Idle,
  [EPodState.Stopped]: EDotTone.Idle,
}

function ChipIcon({ state }: { state: EPodState }) {
  if (state === EPodState.Starting) return <Spinner className="size-3" />
  return <StatusDot tone={DOT_TONE[state]} />
}

function SizeNote({
  status,
  pending,
  canChange,
}: {
  status: PodStatus
  pending?: number
  canChange: boolean
}) {
  if (pending !== undefined) {
    return (
      <p className="text-xs text-muted-foreground">Applies at next wake: {sizeLabel(pending)}</p>
    )
  }
  if (canChange) return null
  const reason =
    status.state === EPodState.Starting
      ? 'Size can be changed once the pod is up.'
      : 'This pod is stopped.'
  return <p className="text-xs text-muted-foreground">{reason}</p>
}

function PodDetails({ status }: { status: PodStatus }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <ChipIcon state={status.state} />
        <span className="text-sm">{STATE_LABEL[status.state]}</span>
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        {status.podId} · {status.region}
      </p>
    </div>
  )
}

function PodPopoverBody({ status }: { status: PodStatus }) {
  const [selected, setSelected] = useState(status.pendingVcpus ?? status.vcpus)
  const [pending, setPending] = useState(status.pendingVcpus)
  const [applying, setApplying] = useState(false)
  const canChange = canResize(status.state)
  const locked = !canChange || applying
  const unchanged = selected === status.vcpus || selected === pending

  useEffect(() => {
    if (!applying) return undefined
    const timer = setTimeout(() => {
      setPending(selected)
      setApplying(false)
    }, APPLY_DELAY_MS)
    return () => clearTimeout(timer)
  }, [applying, selected])

  const handleSizeChange = (values: string[]) => {
    const next = Number(values[0])
    if (VCPU_STEPS.includes(next)) setSelected(next)
  }

  const handleApply = () => setApplying(true)

  return (
    <>
      <PopoverTitle className="text-sm font-medium">Pod</PopoverTitle>
      <PodDetails status={status} />
      <div className="flex flex-col gap-2 border-t border-border pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Size
          </span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            RAM {ramOf(selected)} GB
          </span>
        </div>
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[String(selected)]}
          onValueChange={handleSizeChange}
          disabled={locked}
          aria-label="vCPUs"
          className="w-full"
        >
          {VCPU_STEPS.map((vcpus) => (
            <ToggleGroupItem key={vcpus} value={String(vcpus)} className="flex-1 tabular-nums">
              {vcpus} vCPU
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">2 GB per vCPU — RAM moves with the CPU.</p>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={locked || unchanged} onClick={handleApply}>
            {applying ? <Spinner className="size-3.5" /> : null}
            {applying ? 'Applying…' : 'Apply'}
          </Button>
          <SizeNote status={status} pending={pending} canChange={canChange} />
        </div>
      </div>
      <p className="border-t border-border pt-2.5 text-xs text-muted-foreground">
        Default size for new pods:{' '}
        <span className="text-foreground underline underline-offset-3">Settings → Cloud</span>
      </p>
    </>
  )
}

export function PodStatusChip({ status, defaultOpen = false }: PodChipConfig) {
  const parked = status.state === EPodState.Parked

  return (
    <Popover defaultOpen={defaultOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Pod status"
            className={cn('gap-1.5 text-xs', parked && 'text-muted-foreground')}
          />
        }
      >
        <ChipIcon state={status.state} />
        <span className="tabular-nums">{chipLabel(status)}</span>
      </PopoverTrigger>
      <PopoverContent align="end" initialFocus={false} className="w-80 gap-2.5">
        <PodPopoverBody status={status} />
      </PopoverContent>
    </Popover>
  )
}
