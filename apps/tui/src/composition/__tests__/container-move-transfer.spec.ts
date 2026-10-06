import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import type { RelocationTransferProgress } from '@dltech/atlas-harness'

import {
  beginMove,
  EStepMark,
  failMove,
  settleMoveNode,
  startMoveNode,
  updateMoveTransfer,
  type ContainerMove,
} from '../container-move'

const STARTED_AT = 10_000

const ROWS = [
  { id: 'capture', text: 'packing the work', nodeIds: ['captureWorkspace', 'archiveSession'] },
  { id: 'provision', text: 'waiting for the sandbox', nodeIds: ['provision'] },
] as const

const reading = (over: Partial<RelocationTransferProgress> = {}): RelocationTransferProgress => ({
  nodeId: 'captureWorkspace',
  transferId: 'workspace-upload',
  label: 'uploading workspace',
  transferredBytes: 100,
  totalBytes: 400,
  complete: false,
  ...over,
})

const started = (): ContainerMove => {
  const begun = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT, rows: ROWS })
  return startMoveNode({ move: begun, nodeId: 'captureWorkspace', now: STARTED_AT + 500 })
}

describe('transfer progress on a running row', () => {
  it('records the reading on the row behind the node without touching marks', () => {
    const before = started()

    const move = updateMoveTransfer({ move: before, progress: reading() })

    expect(move.rows[0]?.transfers).toEqual([
      {
        nodeId: 'captureWorkspace',
        transferId: 'workspace-upload',
        label: 'uploading workspace',
        transferredBytes: 100,
        totalBytes: 400,
        complete: false,
      },
    ])
    expect(move.rows.map((row) => row.mark)).toEqual([EStepMark.Active, EStepMark.Pending])
    expect(move.activeSince).toBe(before.activeSince)
    expect(move.startedNodeIds).toEqual(before.startedNodeIds)
    expect(move.doneNodeIds).toEqual(before.doneNodeIds)
  })

  it('replaces a later reading of the same transfer in place', () => {
    const first = updateMoveTransfer({ move: started(), progress: reading() })

    const move = updateMoveTransfer({ move: first, progress: reading({ transferredBytes: 300 }) })

    expect(move.rows[0]?.transfers).toHaveLength(1)
    expect(move.rows[0]?.transfers?.[0]?.transferredBytes).toBe(300)
  })

  it('returns the same move for an identical reading', () => {
    const first = updateMoveTransfer({ move: started(), progress: reading() })

    expect(updateMoveTransfer({ move: first, progress: reading() })).toBe(first)
  })

  it('keeps transfers with different ids apart', () => {
    const first = updateMoveTransfer({ move: started(), progress: reading() })

    const move = updateMoveTransfer({
      move: first,
      progress: reading({ transferId: 'session-upload', label: 'uploading conversation', transferredBytes: 5, totalBytes: 10 }),
    })

    expect(move.rows[0]?.transfers?.map((transfer) => transfer.transferId)).toEqual([
      'workspace-upload',
      'session-upload',
    ])
  })

  it('keeps the same transfer id on different nodes apart', () => {
    const both = startMoveNode({ move: started(), nodeId: 'archiveSession', now: STARTED_AT + 600 })
    const first = updateMoveTransfer({ move: both, progress: reading() })

    const move = updateMoveTransfer({ move: first, progress: reading({ nodeId: 'archiveSession', transferredBytes: 7 }) })

    expect(move.rows[0]?.transfers?.map((transfer) => transfer.nodeId)).toEqual([
      'captureWorkspace',
      'archiveSession',
    ])
  })

  it('does not settle the node when the transfer completes', () => {
    const move = updateMoveTransfer({
      move: started(),
      progress: reading({ transferredBytes: 400, complete: true }),
    })

    expect(move.rows[0]?.mark).toBe(EStepMark.Active)
    expect(move.rows[0]?.transfers?.[0]?.complete).toBe(true)
    expect(move.doneNodeIds).toEqual([])
  })

  it('carries an unknown total through as undefined', () => {
    const move = updateMoveTransfer({ move: started(), progress: reading({ totalBytes: undefined }) })

    expect(move.rows[0]?.transfers?.[0]?.totalBytes).toBeUndefined()
  })
})

describe('transfer progress that has nowhere to land', () => {
  it('ignores a node no row holds', () => {
    const before = started()

    expect(updateMoveTransfer({ move: before, progress: reading({ nodeId: 'ghost' }) })).toBe(before)
  })

  it('ignores a node that has not started', () => {
    const before = started()

    expect(updateMoveTransfer({ move: before, progress: reading({ nodeId: 'provision' }) })).toBe(before)
  })

  it('ignores a node that already settled', () => {
    const settled = settleMoveNode({ move: started(), nodeId: 'captureWorkspace', now: STARTED_AT + 900 })

    expect(updateMoveTransfer({ move: settled, progress: reading() })).toBe(settled)
  })

  it('ignores late readings once the move has failed', () => {
    const failed = failMove({ move: started(), reason: 'upload dropped' })

    expect(updateMoveTransfer({ move: failed, progress: reading() })).toBe(failed)
  })

  it('does not reopen a row that is not active', () => {
    const begun = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT, rows: ROWS })
    const marked: ContainerMove = {
      ...begun,
      startedNodeIds: ['captureWorkspace'],
      rows: begun.rows.map((row) => ({ ...row, mark: EStepMark.Done })),
    }

    expect(updateMoveTransfer({ move: marked, progress: reading() })).toBe(marked)
  })
})
