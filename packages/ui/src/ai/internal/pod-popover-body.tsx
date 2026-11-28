import { useState } from 'react'

import { Button } from '#components/button'
import { InlineSpinner } from './status-dot'
import { ChipIcon } from './pod-chip-icon'
import {
  canResize,
  EPodState,
  ramOf,
  ResizeDeclinedError,
  sizeLabel,
  STATE_LABEL,
  type PodStatus,
} from '../pod-status'
import { VcpuSizeSelect } from '../vcpu-size-select'

interface SizeNoteProps {
  status: PodStatus
  canChange: boolean
  failed: boolean
  failureDetail?: string
}

function SizeNote({ status, canChange, failed, failureDetail }: SizeNoteProps) {
  if (failed) {
    return (
      <p className="text-xs text-destructive">
        Could not resize the pod.{failureDetail === undefined ? '' : ` ${failureDetail}`}
      </p>
    )
  }
  const pending = status.pendingVcpus
  if (pending !== undefined) {
    if (status.phase === 'waiting') {
      return (
        <p className="text-xs text-muted-foreground">
          Waiting for idle to resize to {sizeLabel(pending)}
        </p>
      )
    }
    const lead =
      status.state === EPodState.Parked
        ? 'Starts with'
        : status.phase === 'resizing'
          ? 'Resizing to'
          : 'Restarting with'
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
          {status.region === undefined ? '' : `, ${status.region}`}
        </p>
      )}
    </div>
  )
}

export interface PodPopoverBodyProps {
  status: PodStatus
  sizes: readonly number[]
  onResize?: (vcpus: number) => Promise<void>
  planCapHint?: string
  settingsHref?: string
}

export function PodPopoverBody({
  status,
  sizes,
  onResize,
  planCapHint,
  settingsHref,
}: PodPopoverBodyProps) {
  const target = status.pendingVcpus ?? status.vcpus ?? sizes[0] ?? 1
  const [selected, setSelected] = useState(target)
  const [syncedTarget, setSyncedTarget] = useState(target)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string>()
  if (syncedTarget !== target) {
    setSyncedTarget(target)
    setSelected(target)
    setApplyError(undefined)
  }
  const canChange = canResize(status.state)
  const resizing =
    status.pendingVcpus !== undefined &&
    status.state !== EPodState.Parked &&
    status.phase !== 'failed'
  const locked = !canChange || resizing || applying || !onResize
  const unchanged = selected === status.vcpus || selected === status.pendingVcpus
  const failed = status.phase === 'failed' || applyError !== undefined
  const failureDetail = status.resizeError ?? applyError

  const handleSizeChange = (value: string) => {
    const next = Number(value)
    if (sizes.includes(next)) setSelected(next)
  }

  const handleApply = async () => {
    if (!onResize) return
    setApplying(true)
    setApplyError(undefined)
    try {
      await onResize(selected)
    } catch (failure) {
      const declined = failure instanceof ResizeDeclinedError
      if (!declined && failure instanceof Error && failure.message !== '') {
        setApplyError(failure.message)
      }
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
        <VcpuSizeSelect
          sizes={sizes}
          value={String(selected)}
          onValueChange={handleSizeChange}
          disabled={locked}
          aria-label="vCPUs"
        />
        <p className="text-xs text-muted-foreground">2 GB per vCPU — RAM moves with the CPU.</p>
        {planCapHint === undefined ? null : (
          <p className="text-xs text-muted-foreground">{planCapHint}</p>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={locked || (unchanged && !failed)} onClick={handleApply}>
            {applying ? <InlineSpinner /> : null}
            {applying ? 'Applying…' : failed ? 'Retry' : 'Apply'}
          </Button>
          <SizeNote
            status={status}
            canChange={canChange}
            failed={failed}
            failureDetail={failureDetail}
          />
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
