import { describe, expect, it } from 'bun:test'


import {
  activateMoveRow,
  beginMove,
  EStepMark,
  expandMove,
  failMove,
  DEFAULT_MOVE_HEADING,
  relabelMoveRow,
  settleMoveNode,
  startMoveNode,
} from '../container-move'

const STARTED_AT = 10_000

const BIRTH_ROWS = [
  {
    id: 'provision',
    text: 'waiting for the sandbox',
    nodeIds: ['provision', 'uploadContext'],
  },
  { id: 'attach', text: 'attaching to the conversation', nodeIds: ['attach'] },
  { id: 'flipOwnership', text: 'handing the conversation over', nodeIds: ['flipOwnership'] },
] as const

describe('the rows a move narrates', () => {
  it('starts every row pending until its nodes begin', () => {
    const move = beginMove({ now: STARTED_AT, rows: BIRTH_ROWS })

    expect(move.rows.map((row) => row.mark)).toEqual([
      EStepMark.Pending,
      EStepMark.Pending,
      EStepMark.Pending,
    ])
    expect(move.startedAt).toBe(STARTED_AT)
    expect(move.activeSince).toBe(STARTED_AT)
    expect(move.failure).toBeNull()
  })
})

describe('settling the nodes behind a row', () => {
  it('keeps a concurrent wave active until its slowest node lands', () => {
    let move = beginMove({ now: STARTED_AT, rows: BIRTH_ROWS })
    for (const nodeId of ['provision', 'uploadContext', 'attach']) {
      move = startMoveNode({ move, nodeId, now: STARTED_AT + 500 })
    }
    expect(move.rows.map((row) => row.mark)).toEqual([
      EStepMark.Active,
      EStepMark.Active,
      EStepMark.Pending,
    ])

    move = settleMoveNode({ move, nodeId: 'provision', now: STARTED_AT + 1_000 })
    expect(move.rows.map((row) => row.mark)).toEqual([
      EStepMark.Active,
      EStepMark.Active,
      EStepMark.Pending,
    ])

    move = settleMoveNode({ move, nodeId: 'uploadContext', now: STARTED_AT + 3_000 })
    expect(move.rows.map((row) => row.mark)).toEqual([
      EStepMark.Done,
      EStepMark.Active,
      EStepMark.Pending,
    ])
  })

  it('ignores a node no row is waiting on', () => {
    const begun = beginMove({ now: STARTED_AT, rows: BIRTH_ROWS })

    const move = settleMoveNode({ move: begun, nodeId: 'captureGpg', now: STARTED_AT + 1_000 })

    expect(move.rows.map((row) => row.mark)).toEqual(begun.rows.map((row) => row.mark))
    expect(move.doneNodeIds).toEqual(begun.doneNodeIds)
  })
})

describe('a hand-listed move with no completion signal', () => {
  it('jumps to a row, completing everything before it', () => {
    const begun = beginMove({ now: STARTED_AT, rows: BIRTH_ROWS })

    const move = activateMoveRow({ move: begun, id: 'attach', now: STARTED_AT + 4_000 })

    expect(move.rows.map((row) => row.mark)).toEqual([
      EStepMark.Done,
      EStepMark.Active,
      EStepMark.Pending,
    ])
    expect(move.activeSince).toBe(STARTED_AT + 4_000)
  })
})

describe('a row whose label changes mid-flight', () => {
  it('retexts the row the node feeds without touching its mark', () => {
    const begun = beginMove({ now: STARTED_AT, rows: BIRTH_ROWS })
    const waiting = activateMoveRow({ move: begun, id: 'provision', now: STARTED_AT + 4_000 })

    const move = relabelMoveRow({ move: waiting, nodeId: 'provision', text: 'sending skills and memory to the sandbox' })

    const row = move.rows.find((candidate) => candidate.id === 'provision')
    expect(row?.text).toBe('sending skills and memory to the sandbox')
    expect(row?.mark).toBe(EStepMark.Active)
  })
})

describe('a move that grows a row mid-flight', () => {
  it('inserts ahead of the named row, completing what already passed', () => {
    const begun = beginMove({ now: STARTED_AT, rows: BIRTH_ROWS })
    const waiting = activateMoveRow({ move: begun, id: 'attach', now: STARTED_AT + 4_000 })

    const move = expandMove({
      move: waiting,
      insertBefore: 'attach',
      row: { id: 'rotating', text: 'updating the cloud sandbox', nodeIds: ['rotating'] },
      now: STARTED_AT + 5_000,
    })

    expect(move.rows.map((row) => row.id)).toEqual([
      'provision',
      'rotating',
      'attach',
      'flipOwnership',
    ])
    expect(move.rows.map((row) => row.mark)).toEqual([
      EStepMark.Done,
      EStepMark.Active,
      EStepMark.Pending,
      EStepMark.Pending,
    ])
    expect(move.activeSince).toBe(STARTED_AT + 5_000)
  })
})

describe('a move that does not finish', () => {
  it('fails the row it was on and keeps the reason', () => {
    const begun = beginMove({ now: STARTED_AT, rows: BIRTH_ROWS })
    const waiting = activateMoveRow({ move: begun, id: 'provision', now: STARTED_AT + 4_000 })

    const move = failMove({ move: waiting, reason: 'no capacity in iad1' })

    expect(move.rows.map((row) => row.mark)).toEqual([
      EStepMark.Failed,
      EStepMark.Pending,
      EStepMark.Pending,
    ])
    expect(move.failure).toBe('no capacity in iad1')
  })
})

describe('the heading over the rows', () => {
  it('names the cloud sandbox start by default', () => {
    expect(DEFAULT_MOVE_HEADING).toBe('STARTING A CLOUD SANDBOX')
  })
})
