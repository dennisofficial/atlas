import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo, useRef, useState } from 'react'

import type { EExecutionLocation } from '@dltech/atlas-core'
import type { BirthTransferProgress } from '@dltech/atlas-harness'

import { createAwakeClock } from './awake-clock'
import {
  activateMoveRow,
  beginMove,
  expandMove,
  failMove,
  relabelMoveRow,
  settleMoveNode,
  startMoveNode,
  updateMoveTransfer,
  type ContainerMove,
} from './container-move'
import { isCancelKey } from './container-move-birth'
import { useTickingNow } from './use-turn-clock'

export type MoveRowSeed = { id: string; text: string; nodeIds: readonly string[] }

export type ContainerMoveControl = {
  move: ContainerMove | null
  now: number
  handleBegin: (args: {
    target: EExecutionLocation
    rows: readonly MoveRowSeed[]
    heading?: string | undefined
    onCancel?: (() => void) | undefined
  }) => void
  handleCancel: () => void
  handleNodeStart: (nodeId: string) => void
  handleNodeDone: (nodeId: string) => void
  handleTransferProgress: (progress: BirthTransferProgress) => void
  handleRowActive: (id: string) => void
  handleRowLabel: (args: { nodeId: string; text: string }) => void
  handleExpand: (args: { insertBefore: string; row: MoveRowSeed; heading?: string | undefined }) => void
  handleSettle: () => void
  handleFail: (reason: string) => void
  handleDismiss: () => void
  handleKey: (key: KeyEvent) => void
}

export type MoveStepTiming = { step: string; at: number }

export function useContainerMove(args?: {
  onStep?: ((timing: MoveStepTiming) => void) | undefined
}): ContainerMoveControl {
  const clock = useMemo(() => createAwakeClock(), [])
  const [move, setMove] = useState<ContainerMove | null>(null)
  const now = useTickingNow({ ticking: move !== null && move.failure === null, clock })
  const cancelling = useRef<(() => void) | undefined>(undefined)
  const moveRef = useRef<ContainerMove | null>(null)
  moveRef.current = move

  const handleBegin = useCallback(
    (beginArgs: {
      target: EExecutionLocation
      rows: readonly MoveRowSeed[]
      heading?: string | undefined
      onCancel?: (() => void) | undefined
    }) => {
      if (beginArgs.onCancel !== undefined && moveRef.current === null) cancelling.current = beginArgs.onCancel
      setMove(
        (current) =>
          current ??
          beginMove({
            target: beginArgs.target,
            now: clock.read(),
            rows: beginArgs.rows,
            cancellable: beginArgs.onCancel !== undefined,
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

  const handleTransferProgress = useCallback((progress: BirthTransferProgress) => {
    setMove((current) => (current === null ? null : updateMoveTransfer({ move: current, progress })))
  }, [])

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

  const handleSettle = useCallback(() => {
    cancelling.current = undefined
    setMove(null)
  }, [])

  const handleFail = useCallback((reason: string) => {
    setMove((current) => (current === null ? null : failMove({ move: current, reason })))
  }, [])

  const handleCancel = useCallback(() => {
    const held = moveRef.current
    if (held === null || held.failure !== null || held.cancellable !== true) return
    const onCancel = cancelling.current
    cancelling.current = undefined
    setMove(null)
    onCancel?.()
  }, [])

  const handleDismiss = useCallback(() => {
    if (moveRef.current?.failure === null) {
      handleCancel()
      return
    }
    setMove(null)
  }, [handleCancel])

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (key.eventType === 'release') return
      if (isCancelKey(key)) handleDismiss()
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
      handleCancel,
      handleTransferProgress,
      handleRowActive,
      handleRowLabel,
      handleExpand,
      handleSettle,
      handleFail,
      handleDismiss,
      handleKey,
    }),
    [move, now, handleBegin, handleNodeStart, handleNodeDone, handleCancel, handleTransferProgress, handleRowActive, handleRowLabel, handleExpand, handleSettle, handleFail, handleDismiss, handleKey],
  )
}
