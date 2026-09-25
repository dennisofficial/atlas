import type { KeyEvent } from '@opentui/core'
import type { RewindKill } from '@dltech/atlas-harness'
import { useCallback, useMemo, useRef, useState } from 'react'

import { openRewindConfirm, type RewindConfirmState } from '../ui/rewind-confirm-model'

export type RewindConfirmControl = {
  state: RewindConfirmState | null
  handleOpen: (args: {
    toSeq: number
    kills: readonly RewindKill[]
    reachable?: boolean | undefined
    onConfirmed: () => void
  }) => void
  handleDismiss: () => void
  handleConfirm: () => void
  handleKey: (key: KeyEvent) => void
}

/**
 * The continuation lives beside the state rather than in it: the state is what the drawer renders,
 * and what confirming runs is whichever rewind asked — the picker's, or a resume's discard.
 */
export function useRewindConfirm(): RewindConfirmControl {
  const [state, setState] = useState<RewindConfirmState | null>(null)
  const continuation = useRef<() => void>(() => undefined)

  const handleOpen = useCallback(
    (args: {
      toSeq: number
      kills: readonly RewindKill[]
      reachable?: boolean | undefined
      onConfirmed: () => void
    }) => {
      continuation.current = args.onConfirmed
      setState(openRewindConfirm(args))
    },
    [],
  )

  const handleDismiss = useCallback(() => {
    continuation.current = () => undefined
    setState(null)
  }, [])

  const handleConfirm = useCallback(() => {
    if (state === null) return
    const run = continuation.current
    handleDismiss()
    run()
  }, [handleDismiss, state])

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (state === null) return

      if (key.name === 'escape') {
        handleDismiss()
        return
      }

      if (key.name === 'return') handleConfirm()
    },
    [handleConfirm, handleDismiss, state],
  )

  return useMemo(
    () => ({ state, handleOpen, handleDismiss, handleConfirm, handleKey }),
    [handleConfirm, handleDismiss, handleKey, handleOpen, state],
  )
}
