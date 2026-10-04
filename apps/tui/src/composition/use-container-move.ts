import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo, useState } from 'react'

import type { EExecutionLocation } from '@dltech/atlas-core'

import { createAwakeClock } from './awake-clock'
import {
  activateMoveRow,
  beginMove,
  expandMove,
  failMove,
  relabelMoveRow,
  settleMoveNode,
  startMoveNode,
  type ContainerMove,
} from './container-move'
import { useTickingNow } from './use-turn-clock'

export type MoveRowSeed = { id: string; text: string; nodeIds: readonly string[] }

export type ContainerMoveControl = {
  move: ContainerMove | null
  now: number
  handleBegin: (args: {
    target: EExecutionLocation
    rows: readonly MoveRowSeed[]
    heading?: string | undefined
  }) => void
  /** A DAG node started — its row turns active. */
  handleNodeStart: (nodeId: string) => void
  /** A DAG node settled — its row completes once every node behind it has. */
  handleNodeDone: (nodeId: string) => void
  /** Jumps to a row, completing everything before it — for hand-listed moves with no completion signal. */
  handleRowActive: (id: string) => void
  handleRowLabel: (args: { nodeId: string; text: string }) => void
  handleExpand: (args: { insertBefore: string; row: MoveRowSeed; heading?: string | undefined }) => void
  handleSettle: () => void
  handleFail: (reason: string) => void
  handleDismiss: () => void
  handleKey: (key: KeyEvent) => void
}

/**
 * Timestamps each row transition, so a live round-trip can report per-stage latency without the
 * move overlay persisting anything. Inert unless the caller reads the log.
 */
export type MoveStepTiming = { step: string; at: number }

export function useContainerMove(args?: {
  onStep?: ((timing: MoveStepTiming) => void) | undefined
}): ContainerMoveControl {
  const clock = useMemo(() => createAwakeClock(), [])
  const [move, setMove] = useState<ContainerMove | null>(null)
  const now = useTickingNow({ ticking: move !== null && move.failure === null, clock })

  const handleBegin = useCallback(
    (beginArgs: {
      target: EExecutionLocation
      rows: readonly MoveRowSeed[]
      heading?: string | undefined
    }) => {
      setMove(
        (current) =>
          current ??
          beginMove({
            target: beginArgs.target,
            now: clock.read(),
            rows: beginArgs.rows,
            ...(beginArgs.heading === undefined ? {} : { heading: beginArgs.heading }),
          }),
      )
    },
    [clock],
  )

  const handleNodeStart = useCallback(
    (nodeId: string) => {
      const at = clock.read()
      setMove((current) => (current === null ? null : startMoveNode({ move: current, nodeId, now: at })))
    },
    [clock],
  )

  const handleNodeDone = useCallback(
    (nodeId: string) => {
      const at = clock.read()
      setMove((current) => (current === null ? null : settleMoveNode({ move: current, nodeId, now: at })))
      args?.onStep?.({ step: nodeId, at })
    },
    [clock, args],
  )

  const handleRowActive = useCallback(
    (id: string) => {
      const at = clock.read()
      setMove((current) => (current === null ? null : activateMoveRow({ move: current, id, now: at })))
      args?.onStep?.({ step: id, at })
    },
    [clock, args],
  )

  const handleRowLabel = useCallback((labelArgs: { nodeId: string; text: string }) => {
    setMove((current) =>
      current === null ? null : relabelMoveRow({ move: current, nodeId: labelArgs.nodeId, text: labelArgs.text }),
    )
  }, [])

  const handleExpand = useCallback(
    (expandArgs: { insertBefore: string; row: MoveRowSeed; heading?: string | undefined }) => {
      setMove((current) =>
        current === null
          ? null
          : expandMove({
              move: current,
              insertBefore: expandArgs.insertBefore,
              row: expandArgs.row,
              ...(expandArgs.heading === undefined ? {} : { heading: expandArgs.heading }),
              now: clock.read(),
            }),
      )
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
    () => ({
      move,
      now,
      handleBegin,
      handleNodeStart,
      handleNodeDone,
      handleRowActive,
      handleRowLabel,
      handleExpand,
      handleSettle,
      handleFail,
      handleDismiss,
      handleKey,
    }),
    [move, now, handleBegin, handleNodeStart, handleNodeDone, handleRowActive, handleRowLabel, handleExpand, handleSettle, handleFail, handleDismiss, handleKey],
  )
}
