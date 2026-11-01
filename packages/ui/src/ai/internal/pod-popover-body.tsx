import { useState } from 'react'

import { Button } from '#components/button'
import { ToggleGroup, ToggleGroupItem } from '#components/toggle-group'
import { InlineSpinner } from './status-dot'
import { ChipIcon } from './pod-chip-icon'
import {
  canResize,
  DEFAULT_VCPUS,
  EPodState,
  ramOf,
  ResizeDeclinedError,
  sizeLabel,
  STATE_LABEL,
  VCPU_STEPS,
  type PodStatus,
} from '../pod-status'

interface SizeNoteProps {
  status: PodStatus
  pending?: number
  canChange: boolean
  failed: boolean
}

function SizeNote({ status, pending, canChange, failed }: SizeNoteProps) {
  if (failed) return <p className="text-xs text-destructive">Could not resize the pod.</p>
  if (pending !== undefined) {
    const lead = status.state === EPodState.Parked ? 'Starts with' : 'Restarting with'
    return (
      <p className="text-xs text-muted-foreground">
        {lead} {sizeLabel(pending)}
      </p>
    )
  }
  if (canChange) {
    const reason =
      status.state === EPodState.Parked ? 'Applies on next start' : 'Applying restarts the pod'
    return <p className="text-xs text-muted-foreground">{reason}</p>
  }
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
      {status.podId === undefined ? null : (
        <p className="font-mono text-xs text-muted-foreground">
          {status.podId}
          {status.region === undefined ? '' : ` · ${status.region}`}
        </p>
      )}
    </div>
  )
}

export interface PodPopoverBodyProps {
  status: PodStatus
  onResize?: (vcpus: number) => Promise<void>
  settingsHref?: string
}

export function PodPopoverBody({ status, onResize, settingsHref }: PodPopoverBodyProps) {
  const target = status.pendingVcpus ?? status.vcpus ?? DEFAULT_VCPUS
  const [selected, setSelected] = useState(target)
  const [syncedTarget, setSyncedTarget] = useState(target)
  const [requested, setRequested] = useState<number>()
  const [applying, setApplying] = useState(false)
  const [failed, setFailed] = useState(false)
  if (syncedTarget !== target) {
    setSyncedTarget(target)
    setSelected(target)
    setRequested(undefined)
  }
  const pending = status.pendingVcpus ?? requested
  const canChange = canResize(status.state)
  const restarting = status.pendingVcpus !== undefined && status.state !== EPodState.Parked
  const locked = !canChange || restarting || applying || !onResize
  const unchanged = selected === status.vcpus || selected === pending

  const handleSizeChange = (values: string[]) => {
    const next = Number(values[0])
    if (VCPU_STEPS.includes(next)) setSelected(next)
  }

  const handleApply = async () => {
    if (!onResize) return
    setApplying(true)
    setFailed(false)
    try {
      await onResize(selected)
      setRequested(selected)
    } catch (failure) {
      setFailed(!(failure instanceof ResizeDeclinedError))
    } finally {
      setApplying(false)
    }
  }

  return (
    <>
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
            {applying ? <InlineSpinner /> : null}
            {applying ? 'Applying…' : 'Apply'}
          </Button>
          <SizeNote status={status} pending={pending} canChange={canChange} failed={failed} />
        </div>
      </div>
      {settingsHref ? (
        <p className="border-t border-border pt-2.5 text-xs text-muted-foreground">
          Default size for new pods:{' '}
          <a href={settingsHref} className="text-foreground underline underline-offset-3">
            Settings → Sandbox
          </a>
        </p>
      ) : null}
    </>
  )
}
