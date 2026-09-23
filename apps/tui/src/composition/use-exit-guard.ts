import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo, useState } from 'react'

import {
  EExitChoice,
  exitGuardOptions,
  moveSelection,
  openExitGuard,
  resolve,
  type ExitGuardOption,
  type ExitGuardState,
} from '../ui/exit-guard-model'

export type ExitGuardControl = {
  state: ExitGuardState | null
  options: readonly ExitGuardOption[]
  cloud: boolean
  handleOpen: () => void
  handleDismiss: () => void
  handlePick: (choice: EExitChoice) => void
  handleKey: (key: KeyEvent) => void
}

export function useExitGuard(args: {
  cloud: boolean
  onExit: () => void
  onDetach: () => void
}): ExitGuardControl {
  const [state, setState] = useState<ExitGuardState | null>(null)
  const { cloud, onExit, onDetach } = args
  const options = useMemo(() => exitGuardOptions({ cloud }), [cloud])

  const handleOpen = useCallback(() => setState(openExitGuard({ options })), [options])

  const handleDismiss = useCallback(() => setState(null), [])

  const handlePick = useCallback(
    (choice: EExitChoice) => {
      setState(null)
      if (choice === EExitChoice.StopAndExit) onExit()
      if (choice === EExitChoice.Detach) onDetach()
    },
    [onDetach, onExit],
  )

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (state === null) return

      if (key.name === 'escape') {
        handleDismiss()
        return
      }

      if (key.name === 'return') {
        const choice = resolve({ options, state })
        if (choice !== null) handlePick(choice)
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        setState(moveSelection({ options, state, delta: key.name === 'up' ? -1 : 1 }))
      }
    },
    [handleDismiss, handlePick, options, state],
  )

  return useMemo(
    () => ({ state, options, cloud, handleOpen, handleDismiss, handlePick, handleKey }),
    [cloud, handleDismiss, handleKey, handleOpen, handlePick, options, state],
  )
}
