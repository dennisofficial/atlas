import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo, useState } from 'react'

import type { EExecutionLocation } from '@dltech/atlas-core'

import {
  CONTAINER_GUARD_OPTIONS,
  EContainerGuardChoice,
  openContainerGuard,
} from '../ui/container-guard-model'
import {
  moveStopGuardSelection,
  resolveStopGuard,
  type StopGuardState,
} from '../ui/stop-guard-model'

export type ContainerGuardControl = {
  state: StopGuardState | null
  target: EExecutionLocation | null
  handleOpen: (args: { target: EExecutionLocation }) => void
  handleApply: () => void
  handleDismiss: () => void
  handlePick: (choice: EContainerGuardChoice) => void
  handleKey: (key: KeyEvent) => void
}

export function useContainerGuard(args: {
  onSwitch: (target: EExecutionLocation) => void
}): ContainerGuardControl {
  const [pending, setPending] = useState<{
    state: StopGuardState
    target: EExecutionLocation
  } | null>(null)
  const { onSwitch } = args

  const handleOpen = useCallback((openArgs: { target: EExecutionLocation }) => {
    setPending({ state: openContainerGuard(), target: openArgs.target })
  }, [])

  const handleDismiss = useCallback(() => setPending(null), [])

  const handleApply = useCallback(() => {
    setPending((current) => {
      if (current !== null) onSwitch(current.target)
      return null
    })
  }, [onSwitch])

  const handlePick = useCallback(
    (choice: EContainerGuardChoice) => {
      if (choice === EContainerGuardChoice.SwitchAndStop) {
        handleApply()
        return
      }

      handleDismiss()
    },
    [handleApply, handleDismiss],
  )

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (pending === null) return

      if (key.name === 'escape') {
        handleDismiss()
        return
      }

      if (key.name === 'return') {
        const choice = resolveStopGuard({
          options: CONTAINER_GUARD_OPTIONS,
          state: pending.state,
        })
        if (choice !== null) handlePick(choice)
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        setPending((current) =>
          current === null
            ? current
            : {
                ...current,
                state: moveStopGuardSelection({
                  options: CONTAINER_GUARD_OPTIONS,
                  state: current.state,
                  delta: key.name === 'up' ? -1 : 1,
                }),
              },
        )
      }
    },
    [handleDismiss, handlePick, pending],
  )

  return useMemo(
    () => ({
      state: pending?.state ?? null,
      target: pending?.target ?? null,
      handleOpen,
      handleApply,
      handleDismiss,
      handlePick,
      handleKey,
    }),
    [handleApply, handleDismiss, handleKey, handleOpen, handlePick, pending],
  )
}
