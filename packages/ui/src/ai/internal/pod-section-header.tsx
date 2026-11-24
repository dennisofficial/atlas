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

function wakingOf(state: EPodState): boolean {
  return state === EPodState.Starting || state === EPodState.Resuming
}

function stateTextOf({
  state,
  resizing,
  waiting,
}: {
  state: EPodState
  resizing: boolean
  waiting: boolean
}): string {
  if (waiting) return 'Waiting for idle…'
  return resizing ? 'Resizing…' : STATE_TEXT[state]
}

function powerLabelOf({
  state,
  starting,
  stopping,
  resizing,
  waiting,
}: {
  state: EPodState
  starting: boolean
  stopping: boolean
  resizing: boolean
  waiting: boolean
}): string {
  if (stopping) return 'Stopping pod'
  if (starting) return 'Starting pod'
  if (waiting) return 'Waiting to resize pod'
  if (resizing) return 'Resizing pod'
  if (wakingOf(state)) return 'Starting pod'
  return state === EPodState.Running ? 'Stop pod' : 'Start pod'
}

export interface PodSectionHeaderProps {
  state: EPodState
  starting?: boolean | undefined
  stopping?: boolean | undefined
  resizing?: boolean | undefined
  waiting?: boolean | undefined
  sizeControl?: ReactNode
  onStart?: (() => void) | undefined
  onStop?: (() => void) | undefined
}

export function PodSectionHeader({
  state,
  starting = false,
  stopping = false,
  resizing = false,
  waiting = false,
  sizeControl,
  onStart,
  onStop,
}: PodSectionHeaderProps) {
  const label = powerLabelOf({ state, starting, stopping, resizing, waiting })
  const pending = starting || resizing || waiting || wakingOf(state)
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
                  variant="outline"
                  size="icon-xs"
                  aria-label={label}
                  disabled={busy}
                  onClick={handlePower}
                />
              }
            >
              {pending || stopping ? (
                <InlineSpinner />
              ) : running ? (
                <SquareIcon aria-hidden />
              ) : (
                <PlayIcon aria-hidden />
              )}
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        </span>
        <span className="truncate text-[13px] leading-4">
          {stateTextOf({ state, resizing, waiting })}
        </span>
      </span>
      {sizeControl}
    </div>
  )
}
