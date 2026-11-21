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

function powerLabelOf({ state, stopping }: { state: EPodState; stopping: boolean }): string {
  if (stopping) return 'Stopping pod'
  if (wakingOf(state)) return 'Starting pod'
  return state === EPodState.Running ? 'Stop pod' : 'Start pod'
}

export interface PodSectionHeaderProps {
  state: EPodState
  stopping?: boolean | undefined
  onStart?: (() => void) | undefined
  onStop?: (() => void) | undefined
}

export function PodSectionHeader({
  state,
  stopping = false,
  onStart,
  onStop,
}: PodSectionHeaderProps) {
  const label = powerLabelOf({ state, stopping })
  const busy = stopping || wakingOf(state)
  const running = state === EPodState.Running

  const handlePower = () => {
    if (busy) return
    if (running) onStop?.()
    else onStart?.()
  }

  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <span className="flex min-w-0 items-center gap-2">
        {wakingOf(state) ? <InlineSpinner /> : <StatusDot tone={STATE_TONE[state]} />}
        <span className="truncate text-sm">{STATE_TEXT[state]}</span>
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
