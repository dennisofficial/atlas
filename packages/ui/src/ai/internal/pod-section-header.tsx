'use client'

import { Button } from '#components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '#components/tooltip'
import { PlayIcon, SquareIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { EPodState } from '../pod-status'
import { InlineSpinner } from './status-dot'

const STATE_TEXT: Record<EPodState, string> = {
  [EPodState.Starting]: 'Starting…',
  [EPodState.Running]: 'Running',
  [EPodState.Resuming]: 'Starting…',
  [EPodState.Parked]: 'Sleeping',
  [EPodState.Stopped]: 'Stopped',
}

const POWER_TONE: Record<EPodState, string> = {
  [EPodState.Starting]: 'text-warning',
  [EPodState.Running]: 'text-success',
  [EPodState.Resuming]: 'text-warning',
  [EPodState.Parked]: 'text-muted-foreground',
  [EPodState.Stopped]: 'text-muted-foreground',
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
  sizeControl?: ReactNode
  onStart?: (() => void) | undefined
  onStop?: (() => void) | undefined
}

export function PodSectionHeader({
  state,
  stopping = false,
  resizing = false,
  sizeControl,
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
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={label}
                  disabled={busy}
                  onClick={handlePower}
                  className={POWER_TONE[state]}
                />
              }
            >
              {pending || stopping ? (
                <InlineSpinner />
              ) : running ? (
                <SquareIcon aria-hidden className="fill-current" />
              ) : (
                <PlayIcon aria-hidden className="fill-current" />
              )}
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        </span>
        <span className="truncate text-[13px] leading-4">{stateTextOf({ state, resizing })}</span>
      </span>
      {sizeControl}
    </div>
  )
}
