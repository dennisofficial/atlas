'use client'

import { Button } from '#components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '#components/tooltip'
import { PowerIcon } from 'lucide-react'

import { EPodState } from '../pod-status'
import { EStatusTone, InlineSpinner, StatusDot } from './status-dot'

const STATE_TEXT: Record<EPodState, string> = {
  [EPodState.Starting]: 'Starting…',
  [EPodState.Running]: 'Running',
  [EPodState.Resuming]: 'Starting…',
  [EPodState.Parked]: 'Sleeping',
  [EPodState.Stopped]: 'Stopped',
}

const STATE_TONE: Record<EPodState, EStatusTone> = {
  [EPodState.Starting]: EStatusTone.Pending,
  [EPodState.Running]: EStatusTone.Live,
  [EPodState.Resuming]: EStatusTone.Pending,
  [EPodState.Parked]: EStatusTone.Idle,
  [EPodState.Stopped]: EStatusTone.Idle,
}

function wakingOf(state: EPodState): boolean {
  return state === EPodState.Starting || state === EPodState.Resuming
}

function stateTextOf({ state, resizing }: { state: EPodState; resizing: boolean }): string {
  return resizing ? 'Resizing…' : STATE_TEXT[state]
}

function powerLabelOf({
  state,
  stopping,
  resizing,
}: {
  state: EPodState
  stopping: boolean
  resizing: boolean
}): string {
  if (stopping) return 'Stopping pod'
  if (resizing) return 'Resizing pod'
  if (wakingOf(state)) return 'Starting pod'
  return state === EPodState.Running ? 'Stop pod' : 'Start pod'
}

export interface PodSectionHeaderProps {
  state: EPodState
  stopping?: boolean | undefined
  resizing?: boolean | undefined
  onStart?: (() => void) | undefined
  onStop?: (() => void) | undefined
}

export function PodSectionHeader({
  state,
  stopping = false,
  resizing = false,
  onStart,
  onStop,
}: PodSectionHeaderProps) {
  const label = powerLabelOf({ state, stopping, resizing })
  const pending = resizing || wakingOf(state)
  const busy = stopping || pending
  const running = state === EPodState.Running

  const handlePower = () => {
    if (busy) return
    if (running) onStop?.()
    else onStart?.()
  }

  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <span className="flex min-w-0 items-center gap-2">
        {pending ? <InlineSpinner /> : <StatusDot tone={STATE_TONE[state]} />}
        <span className="truncate text-sm">{stateTextOf({ state, resizing })}</span>
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              disabled={busy}
              onClick={handlePower}
            />
          }
        >
          {busy ? <InlineSpinner /> : <PowerIcon aria-hidden />}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </div>
  )
}
