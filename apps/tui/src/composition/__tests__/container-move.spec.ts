import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'

import {
  activateMoveRow,
  beginMove,
  EStepMark,
  expandMove,
  failMove,
  moveHeading,
  relabelMoveRow,
  settleMoveNode,
  startMoveNode,
} from '../container-move'

const STARTED_AT = 10_000

const BIRTH_ROWS = [
  {
    id: 'provision',
    text: 'waiting for the pod',
    nodeIds: ['provision', 'uploadContext'],
  },
  { id: 'attach', text: 'setting up the workspace', nodeIds: ['attach', 'open', 'flipOwnership'] },
  { id: 'verify', text: 'verifying the conversation', nodeIds: ['verify'] },
] as const

describe('the rows a move narrates', () => {
  it('starts every row pending until its nodes begin', () => {
    const move = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT, rows: BIRTH_ROWS })

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
    let move = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT, rows: BIRTH_ROWS })
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
    const begun = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT, rows: BIRTH_ROWS })

    const move = settleMoveNode({ move: begun, nodeId: 'captureGpg', now: STARTED_AT + 1_000 })

    expect(move.rows.map((row) => row.mark)).toEqual(begun.rows.map((row) => row.mark))
    expect(move.doneNodeIds).toEqual(begun.doneNodeIds)
  })
})

describe('a hand-listed move with no completion signal', () => {
  it('jumps to a row, completing everything before it', () => {
    const begun = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT, rows: BIRTH_ROWS })

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
    const begun = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT, rows: BIRTH_ROWS })
    const waiting = activateMoveRow({ move: begun, id: 'provision', now: STARTED_AT + 4_000 })

    const move = relabelMoveRow({ move: waiting, nodeId: 'provision', text: 'sending local config to the pod' })

    const row = move.rows.find((candidate) => candidate.id === 'provision')
    expect(row?.text).toBe('sending local config to the pod')
    expect(row?.mark).toBe(EStepMark.Active)
  })
})

describe('a move that grows a row mid-flight', () => {
  it('inserts ahead of the named row, completing what already passed', () => {
    const begun = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT, rows: BIRTH_ROWS })
    const waiting = activateMoveRow({ move: begun, id: 'attach', now: STARTED_AT + 4_000 })

    const move = expandMove({
      move: waiting,
      insertBefore: 'attach',
      row: { id: 'rotating', text: 'updating the pod', nodeIds: ['rotating'] },
      now: STARTED_AT + 5_000,
    })

    expect(move.rows.map((row) => row.id)).toEqual([
      'provision',
      'rotating',
      'attach',
      'verify',
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
    const begun = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT, rows: BIRTH_ROWS })
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
  it('names where the conversation is going', () => {
    expect(moveHeading(EExecutionLocation.Cloud)).toBe('STARTING A POD')
    expect(moveHeading(EExecutionLocation.Docker)).toBe('MOVING INTO A DOCKER CONTAINER')
    expect(moveHeading(EExecutionLocation.Host)).toBe('RETURNING TO THE HOST')
  })
})
