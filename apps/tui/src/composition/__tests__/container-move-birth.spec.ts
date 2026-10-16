import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import type { BirthTransferProgress } from '@dltech/atlas-harness'

import { beginMove, startMoveNode, updateMoveTransfer } from '../container-move'
import {
  isCancelKey,
  moveOverlayPresence,
  SERVE_STAGE_TEXT,
  serveStageOf,
} from '../container-move-birth'

const AT = 10_000

const ROWS = [
  { id: 'provision', text: 'waiting for the sandbox', nodeIds: ['provision'] },
  { id: 'attach', text: 'attaching to the conversation', nodeIds: ['attach'] },
] as const

const upload = (over: Partial<BirthTransferProgress> = {}): BirthTransferProgress => ({
  nodeId: 'provision',
  transferId: 'context-upload',
  label: 'uploading skills and memory',
  transferredBytes: 10,
  totalBytes: 10,
  complete: true,
  ...over,
})

const key = (over: { name: string; ctrl?: boolean; eventType?: string }) => over as never

describe('the serve-launch stage', () => {
  const provisioning = (progress: BirthTransferProgress[]) => {
    let move = beginMove({ target: EExecutionLocation.Cloud, now: AT, rows: ROWS })
    move = startMoveNode({ move, nodeId: 'provision', now: AT })
    for (const reading of progress) move = updateMoveTransfer({ move, progress: reading })
    return move.rows[0]
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
