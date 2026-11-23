'use client'

import { useState } from 'react'

import { type PodShape, podShapeLabel } from '../pod-shapes'
import { InlineSpinner } from './status-dot'

export interface PodResizeWaitProps {
  pendingShape: PodShape
  onResizeNow?: (() => Promise<void>) | undefined
  onCancelResize?: (() => Promise<void>) | undefined
}

type EResizeWaitAction = 'resize' | 'cancel'

const WAIT_LABEL: Record<EResizeWaitAction, string> = {
  resize: 'Resize now',
  cancel: 'Cancel',
}

function messageOf(failure: unknown): string {
  return failure instanceof Error && failure.message !== ''
    ? failure.message
    : 'The resize request could not be sent.'
}

export function PodResizeWait({ pendingShape, onResizeNow, onCancelResize }: PodResizeWaitProps) {
  const [running, setRunning] = useState<EResizeWaitAction>()
  const [error, setError] = useState<string>()
  const busy = running !== undefined

  const handleAction = async ({
    action,
    call,
  }: {
    action: EResizeWaitAction
    call: (() => Promise<void>) | undefined
  }) => {
    if (call === undefined || busy) return
    setRunning(action)
    setError(undefined)
    try {
      await call()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setRunning(undefined)
    }
  }

  const handleResizeNow = () => handleAction({ action: 'resize', call: onResizeNow })
  const handleCancel = () => handleAction({ action: 'cancel', call: onCancelResize })

  const actionOf = (action: EResizeWaitAction) => ({
    disabled: busy,
    onClick: action === 'resize' ? handleResizeNow : handleCancel,
  })

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">
        Resizes to {podShapeLabel(pendingShape)} when the pod is idle.
        {onResizeNow === undefined ? null : (
          <>
            {' '}
            <button
              type="button"
              {...actionOf('resize')}
              className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            >
              {running === 'resize' ? <InlineSpinner /> : null}
              {WAIT_LABEL.resize}
            </button>
          </>
        )}
        {onCancelResize === undefined ? null : (
          <>
            {' '}
            <button
              type="button"
              {...actionOf('cancel')}
              className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            >
              {running === 'cancel' ? <InlineSpinner /> : null}
              {WAIT_LABEL.cancel}
            </button>
          </>
        )}
      </p>
      {error === undefined ? null : <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
