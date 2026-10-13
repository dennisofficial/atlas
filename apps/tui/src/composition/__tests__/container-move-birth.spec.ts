import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import type { RelocationTransferProgress } from '@dltech/atlas-harness'

import { beginMove, settleMoveNode, startMoveNode, updateMoveTransfer } from '../container-move'
import {
  isCancelKey,
  moveOverlayPresence,
  SERVE_STAGE_TEXT,
  serveStageOf,
  updateMoveBuild,
} from '../container-move-birth'

const AT = 10_000

const ROWS = [
  { id: 'capture', text: 'packing the uncommitted work', nodeIds: ['captureWorkspace'] },
  { id: 'provision', text: 'waiting for the sandbox', nodeIds: ['provision'] },
] as const

const upload = (over: Partial<RelocationTransferProgress> = {}): RelocationTransferProgress => ({
  nodeId: 'provision',
  transferId: 'workspace-upload',
  label: 'uploading workspace',
  transferredBytes: 10,
  totalBytes: 10,
  complete: true,
  ...over,
})

const key = (over: { name: string; ctrl?: boolean; eventType?: string }) => over as never

describe('capture progress on a birth', () => {
  it('records the build reading on the active capture row', () => {
    let move = beginMove({ target: EExecutionLocation.Cloud, now: AT, rows: ROWS })
    move = startMoveNode({ move, nodeId: 'captureWorkspace', now: AT })

    const next = updateMoveBuild({ move, progress: { phase: 'staging', files: 1204, bytes: 0 } })

    expect(next.build).toEqual({ phase: 'staging', files: 1204, bytes: 0 })
  })

  it('ignores a reading before capture starts, after it settles, and when nothing changed', () => {
    const begun = beginMove({ target: EExecutionLocation.Cloud, now: AT, rows: ROWS })
    const progress = { phase: 'walking', files: 0, bytes: 0 } as const
    expect(updateMoveBuild({ move: begun, progress })).toBe(begun)

    const started = startMoveNode({ move: begun, nodeId: 'captureWorkspace', now: AT })
    const read = updateMoveBuild({ move: started, progress })
    expect(updateMoveBuild({ move: read, progress })).toBe(read)

    const settled = settleMoveNode({ move: read, nodeId: 'captureWorkspace', now: AT + 1 })
    expect(updateMoveBuild({ move: settled, progress: { ...progress, files: 9 } })).toBe(settled)
  })
})

describe('the serve-launch stage', () => {
  const provisioning = (progress: RelocationTransferProgress[]) => {
    let move = beginMove({ target: EExecutionLocation.Cloud, now: AT, rows: ROWS })
    move = startMoveNode({ move, nodeId: 'provision', now: AT })
    for (const reading of progress) move = updateMoveTransfer({ move, progress: reading })
    return move.rows[1]
  }

  it('appears once every upload has landed and the row still waits', () => {
    const row = provisioning([upload()])
    expect(row === undefined ? null : serveStageOf(row)).toBe(SERVE_STAGE_TEXT)
  })

  it('stays hidden while an upload is still moving', () => {
    const row = provisioning([upload({ complete: false, transferredBytes: 4 })])
    expect(row === undefined ? null : serveStageOf(row)).toBeNull()
  })
})

describe('cancelling a birth', () => {
  it('reads esc and ctrl+c as cancel, and nothing else', () => {
    expect(isCancelKey(key({ name: 'escape' }))).toBe(true)
    expect(isCancelKey(key({ name: 'c', ctrl: true }))).toBe(true)
    expect(isCancelKey(key({ name: 'c' }))).toBe(false)
    expect(isCancelKey(key({ name: 'return' }))).toBe(false)
  })

  it('claims the keyboard for a cancellable birth and for a failure, not for a plain move', () => {
    const handleKey = () => undefined
    const plain = beginMove({ target: EExecutionLocation.Cloud, now: AT, rows: ROWS })
    const birth = beginMove({ target: EExecutionLocation.Cloud, now: AT, rows: ROWS, cancellable: true })

    expect(moveOverlayPresence({ move: plain, handleKey }).handleKey).toBeUndefined()
    expect(moveOverlayPresence({ move: birth, handleKey }).handleKey).toBe(handleKey)
    expect(moveOverlayPresence({ move: { ...plain, failure: 'x' }, handleKey }).handleKey).toBe(handleKey)
    expect(moveOverlayPresence({ move: null, handleKey }).open).toBe(false)
  })

  it('blocks the composer for as long as the birth is up', () => {
    const birth = beginMove({ target: EExecutionLocation.Cloud, now: AT, rows: ROWS, cancellable: true })
    const presence = moveOverlayPresence({ move: birth, handleKey: () => undefined })

    expect(presence.open).toBe(true)
    expect(presence.coversComposer).toBe(true)
  })
})
