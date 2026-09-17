import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo, useState } from 'react'

import type { EExecutionLocation } from '@dltech/atlas-core'

import { createAwakeClock } from './awake-clock'
import {
  advanceMove,
  beginMove,
  failMove,
  type ContainerMove,
  type MoveStepId,
} from './container-move'
import { useTickingNow } from './use-turn-clock'

export type ContainerMoveControl = {
  move: ContainerMove | null
  now: number
  handleBegin: (args: {
    target: EExecutionLocation
    plan?: readonly MoveStepId[] | undefined
    heading?: string | undefined
  }) => void
  handleAdvance: (step: MoveStepId) => void
  handleSettle: () => void
  handleFail: (reason: string) => void
  handleDismiss: () => void
  handleKey: (key: KeyEvent) => void
}

export function useContainerMove(): ContainerMoveControl {
  const clock = useMemo(() => createAwakeClock(), [])
  const [move, setMove] = useState<ContainerMove | null>(null)
  const now = useTickingNow({ ticking: move !== null && move.failure === null, clock })

  const handleBegin = useCallback(
    (args: {
      target: EExecutionLocation
      plan?: readonly MoveStepId[] | undefined
      heading?: string | undefined
    }) => {
      setMove(
        (current) =>
          current ??
          beginMove({
            target: args.target,
            now: clock.read(),
            ...(args.plan === undefined ? {} : { plan: args.plan }),
            ...(args.heading === undefined ? {} : { heading: args.heading }),
          }),
      )
    },
    [clock],
  )

  const handleAdvance = useCallback(
    (step: MoveStepId) => {
      setMove((current) => (current === null ? null : advanceMove({ move: current, step, now: clock.read() })))
    },
    [clock],
  )

  const handleSettle = useCallback(() => setMove(null), [])

  const handleFail = useCallback((reason: string) => {
    setMove((current) => (current === null ? null : failMove({ move: current, reason })))
  }, [])

  const handleDismiss = useCallback(() => {
    setMove((current) => (current?.failure === null ? current : null))
  }, [])

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (key.name === 'escape') handleDismiss()
    },
    [handleDismiss],
  )

  return useMemo(
    () => ({ move, now, handleBegin, handleAdvance, handleSettle, handleFail, handleDismiss, handleKey }),
    [move, now, handleBegin, handleAdvance, handleSettle, handleFail, handleDismiss, handleKey],
  )
}
