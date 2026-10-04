import { EExecutionLocation } from '@dltech/atlas-core'

export enum EStepMark {
  Pending = 'pending',
  Active = 'active',
  Done = 'done',
  Failed = 'failed',
}

/**
 * One row of the move overlay. Rows come from the relocation DAG's waves (lift/descend) or from a
 * short hand list (sandbox wake, local container switch) — either way the overlay renders rows, so
 * a node added to or dropped from the DAG changes the list without an edit here. Concurrent rows in
 * one wave are active together and complete independently of the rows after them.
 */
export type MoveRow = {
  id: string
  text: string
  /** The DAG node ids behind this row — it activates on their first start and completes once every one has settled. */
  nodeIds: readonly string[]
  mark: EStepMark
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

/** A DAG node started — its row turns active. */
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

/** A DAG node settled — its row completes once every node behind it has. */
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

/** Advances to the row named by id, completing everything before it — for hand-listed moves with no per-node completion signal. */
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

/**
 * A wake can discover mid-flight that the sandbox needs rotating before it can attach — the probe
 * only answers once it has read the sandbox's stamps. Inserting the row ahead of the named one
 * keeps every mark behind the insertion point (they already happened) and re-activates the new row.
 */
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
