import { EExecutionLocation } from '@dltech/atlas-core'
import type { RelocationTransferProgress } from '@dltech/atlas-harness'

export enum EStepMark {
  Pending = 'pending',
  Active = 'active',
  Done = 'done',
  Failed = 'failed',
}

export type MoveTransfer = {
  nodeId: string
  transferId: string
  label: string
  transferredBytes: number
  totalBytes?: number | undefined
  complete: boolean
}

export type MoveRow = {
  id: string
  text: string
  nodeIds: readonly string[]
  mark: EStepMark
  transfers?: readonly MoveTransfer[]
}

export type ContainerMove = {
  target: EExecutionLocation
  rows: readonly MoveRow[]
  heading?: string | undefined
  startedAt: number
  activeSince: number
  startedNodeIds: readonly string[]
  doneNodeIds: readonly string[]
  failure: string | null
}

export const WAKE_HEADING = 'WAKING THE SANDBOX'

const HEADING: Record<EExecutionLocation, string> = {
  [EExecutionLocation.Cloud]: 'MOVING TO THE CLOUD',
  [EExecutionLocation.Docker]: 'MOVING INTO A DOCKER CONTAINER',
  [EExecutionLocation.Host]: 'MOVING BACK TO THE HOST',
}

export const moveHeading = (target: EExecutionLocation): string => HEADING[target]

export function beginMove(args: {
  target: EExecutionLocation
  now: number
  rows: readonly { id: string; text: string; nodeIds: readonly string[] }[]
  heading?: string | undefined
}): ContainerMove {
  return {
    target: args.target,
    rows: args.rows.map((row) => ({ ...row, mark: EStepMark.Pending })),
    ...(args.heading === undefined ? {} : { heading: args.heading }),
    startedAt: args.now,
    activeSince: args.now,
    startedNodeIds: [],
    doneNodeIds: [],
    failure: null,
  }
}

const recompute = (args: { move: ContainerMove; now: number }): ContainerMove => {
  const started = new Set(args.move.startedNodeIds)
  const done = new Set(args.move.doneNodeIds)
  let activeSince = args.move.activeSince
  const rows = args.move.rows.map((row) => {
    if (row.mark === EStepMark.Done || row.mark === EStepMark.Failed) return row
    const rowStarted = row.nodeIds.some((id) => started.has(id))
    const rowDone = row.nodeIds.length > 0 && row.nodeIds.every((id) => done.has(id))
    if (rowDone) {
      activeSince = args.now
      return { ...row, mark: EStepMark.Done }
    }
    if (rowStarted) {
      activeSince = args.now
      return { ...row, mark: EStepMark.Active }
    }
    return row
  })
  return { ...args.move, rows, activeSince }
}

export function startMoveNode(args: {
  move: ContainerMove
  nodeId: string
  now: number
}): ContainerMove {
  if (!args.move.rows.some((row) => row.nodeIds.includes(args.nodeId))) return args.move
  if (args.move.startedNodeIds.includes(args.nodeId)) return args.move
  return recompute({
    move: { ...args.move, startedNodeIds: [...args.move.startedNodeIds, args.nodeId] },
    now: args.now,
  })
}

export function settleMoveNode(args: {
  move: ContainerMove
  nodeId: string
  now: number
}): ContainerMove {
  if (!args.move.rows.some((row) => row.nodeIds.includes(args.nodeId))) return args.move
  if (args.move.doneNodeIds.includes(args.nodeId)) return args.move
  return recompute({
    move: { ...args.move, doneNodeIds: [...args.move.doneNodeIds, args.nodeId] },
    now: args.now,
  })
}

export function activateMoveRow(args: {
  move: ContainerMove
  id: string
  now: number
}): ContainerMove {
  const at = args.move.rows.findIndex((row) => row.id === args.id)
  if (at === -1) return args.move
  return {
    ...args.move,
    rows: args.move.rows.map((candidate, index) => {
      if (index < at) return { ...candidate, mark: EStepMark.Done }
      if (index === at) return { ...candidate, mark: EStepMark.Active }
      return candidate
    }),
    activeSince: args.now,
  }
}

const sameTransfer = ({ a, b }: { a: MoveTransfer; b: MoveTransfer }): boolean =>
  a.label === b.label &&
  a.transferredBytes === b.transferredBytes &&
  a.totalBytes === b.totalBytes &&
  a.complete === b.complete

export function updateMoveTransfer(args: {
  move: ContainerMove
  progress: RelocationTransferProgress
}): ContainerMove {
  const { move, progress } = args
  if (move.failure !== null) return move
  if (!move.startedNodeIds.includes(progress.nodeId)) return move
  if (move.doneNodeIds.includes(progress.nodeId)) return move

  const rowAt = move.rows.findIndex((row) => row.nodeIds.includes(progress.nodeId))
  const row = move.rows[rowAt]
  if (row === undefined || row.mark !== EStepMark.Active) return move

  const next: MoveTransfer = {
    nodeId: progress.nodeId,
    transferId: progress.transferId,
    label: progress.label,
    transferredBytes: progress.transferredBytes,
    totalBytes: progress.totalBytes,
    complete: progress.complete,
  }
  const held = row.transfers ?? []
  const heldAt = held.findIndex(
    (transfer) => transfer.nodeId === next.nodeId && transfer.transferId === next.transferId,
  )
  const current = held[heldAt]
  if (current !== undefined && sameTransfer({ a: current, b: next })) return move

  const transfers =
    current === undefined
      ? [...held, next]
      : held.map((transfer, index) => (index === heldAt ? next : transfer))
  return {
    ...move,
    rows: move.rows.map((candidate, index) => (index === rowAt ? { ...candidate, transfers } : candidate)),
  }
}

export function relabelMoveRow(args: {
  move: ContainerMove
  nodeId: string
  text: string
}): ContainerMove {
  return {
    ...args.move,
    rows: args.move.rows.map((row) =>
      row.nodeIds.includes(args.nodeId) ? { ...row, text: args.text } : row,
    ),
  }
}

export function expandMove(args: {
  move: ContainerMove
  insertBefore: string
  row: { id: string; text: string; nodeIds: readonly string[] }
  heading?: string | undefined
  now: number
}): ContainerMove {
  const at = args.move.rows.findIndex((row) => row.id === args.insertBefore)
  if (at === -1 || args.move.rows.some((row) => row.id === args.row.id)) return args.move

  return {
    ...args.move,
    ...(args.heading === undefined ? {} : { heading: args.heading }),
    rows: [
      ...args.move.rows.slice(0, at).map((row) => ({ ...row, mark: EStepMark.Done })),
      { ...args.row, mark: EStepMark.Active },
      ...args.move.rows.slice(at).map((row) => ({ ...row, mark: EStepMark.Pending })),
    ],
    activeSince: args.now,
  }
}

export function failMove(args: { move: ContainerMove; reason: string }): ContainerMove {
  return {
    ...args.move,
    rows: args.move.rows.map((row) =>
      row.mark === EStepMark.Active ? { ...row, mark: EStepMark.Failed } : row,
    ),
    failure: args.reason,
  }
}
