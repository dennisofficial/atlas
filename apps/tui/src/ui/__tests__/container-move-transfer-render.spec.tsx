import { describe, expect, it } from 'bun:test'
import React from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'
import type { RelocationTransferProgress } from '@dltech/atlas-harness'

import {
  beginMove,
  failMove,
  settleMoveNode,
  startMoveNode,
  updateMoveTransfer,
  type ContainerMove,
} from '../../composition/container-move'
import { ContainerMoveOverlay } from '../components/container-move'
import { formatBytes, transferPercent, transferSpans } from '../components/transfer-meter'
import { frameOf, mount } from './transcript-fixture'

const STARTED_AT = 10_000
const MIB = 1024 * 1024

const ROWS = [
  { id: 'capture', text: 'packing the work', nodeIds: ['captureWorkspace'] },
  { id: 'restore', text: 'attaching and verifying', nodeIds: ['restore'] },
] as const

const reading = (over: Partial<RelocationTransferProgress> = {}): RelocationTransferProgress => ({
  nodeId: 'captureWorkspace',
  transferId: 'workspace-upload',
  label: 'uploading workspace',
  transferredBytes: 5 * MIB,
  totalBytes: 20 * MIB,
  complete: false,
  ...over,
})

const moveWith = (...readings: RelocationTransferProgress[]): ContainerMove => {
  let move = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT, rows: ROWS })
  move = startMoveNode({ move, nodeId: 'captureWorkspace', now: STARTED_AT })
  for (const progress of readings) move = updateMoveTransfer({ move, progress })
  return move
}

const overlay = (args: { move: ContainerMove; width?: number }) => (
  <ContainerMoveOverlay
    move={args.move}
    now={STARTED_AT + 2_000}
    width={args.width ?? 80}
    onDismiss={() => undefined}
  />
)

describe('a transfer on the active row', () => {
  it('shows an upload with its bar, percentage and sizes', async () => {
    const frame = await frameOf(overlay({ move: moveWith(reading()) }), 80)

    expect(frame).toContain('packing the work (2s)')
    expect(frame).toContain('uploading workspace')
    expect(frame).toContain('25%')
    expect(frame).toContain('5.0 MiB / 20.0 MiB')
    expect(frame).toContain('█')
    expect(frame).toContain('░')
  })

  it('shows a download the same way', async () => {
    const frame = await frameOf(
      overlay({
        move: moveWith(
          reading({ transferId: 'workspace-download', label: 'downloading workspace', transferredBytes: 10 * MIB }),
        ),
      }),
      80,
    )

    expect(frame).toContain('downloading workspace')
    expect(frame).toContain('50%')
    expect(frame).toContain('10.0 MiB / 20.0 MiB')
  })

  it('reads 0% before the first byte', async () => {
    const frame = await frameOf(overlay({ move: moveWith(reading({ transferredBytes: 0 })) }), 80)

    expect(frame).toContain('0%')
    expect(frame).toContain('0 B / 20.0 MiB')
  })

  it('does not round a nearly finished transfer up to 100%', async () => {
    const frame = await frameOf(
      overlay({ move: moveWith(reading({ transferredBytes: 20 * MIB - 1 })) }),
      80,
    )

    expect(frame).toContain('99%')
    expect(frame).not.toContain('100%')
  })

  it('checks off a finished transfer while the row stays active', async () => {
    const frame = await frameOf(
      overlay({ move: moveWith(reading({ transferredBytes: 20 * MIB, complete: true })) }),
      80,
    )

    expect(frame).toContain('✓ uploading workspace')
    expect(frame).toContain('100%')
    expect(frame).toContain('packing the work (2s)')
    expect(frame).not.toContain('✓ packing the work')
  })

  it('shows bytes alone when the total is unknown', async () => {
    const frame = await frameOf(
      overlay({ move: moveWith(reading({ totalBytes: undefined })) }),
      80,
    )

    expect(frame).toContain('uploading workspace')
    expect(frame).toContain('5.0 MiB')
    expect(frame).not.toContain('%')
    expect(frame).not.toContain('NaN')
  })

  it('handles an empty archive without NaN', async () => {
    const empty = await frameOf(
      overlay({ move: moveWith(reading({ transferredBytes: 0, totalBytes: 0 })) }),
      80,
    )
    const done = await frameOf(
      overlay({ move: moveWith(reading({ transferredBytes: 0, totalBytes: 0, complete: true })) }),
      80,
    )

    expect(empty).toContain('0%')
    expect(empty).not.toContain('NaN')
    expect(done).toContain('100%')
    expect(done).not.toContain('NaN')
  })

  it('lists independent transfers on separate lines', async () => {
    const frame = await frameOf(
      overlay({
        move: moveWith(
          reading(),
          reading({ transferId: 'session-upload', label: 'uploading conversation', transferredBytes: 1, totalBytes: 4 }),
        ),
      }),
      80,
    )

    expect(frame).toContain('uploading workspace')
    expect(frame).toContain('uploading conversation')
  })
})

describe('an archive build on the active row', () => {
  it('shows the label and the byte count with no bar or percentage', async () => {
    const frame = await frameOf(
      overlay({
        move: moveWith(
          reading({ transferId: 'archive-build-workspace', label: 'packing the workspace', transferredBytes: 3 * MIB, totalBytes: undefined }),
        ),
      }),
      80,
    )

    expect(frame).toContain('packing the workspace')
    expect(frame).toContain('3.0 MiB')
    expect(frame).not.toContain('%')
    expect(frame).not.toContain('█')
    expect(frame).not.toContain('░')
  })
})

describe('a transfer beyond the active row', () => {
  it('hides the detail once the row is done', async () => {
    const settled = settleMoveNode({
      move: moveWith(reading({ transferredBytes: 20 * MIB, complete: true })),
      nodeId: 'captureWorkspace',
      now: STARTED_AT + 1_000,
    })
    const frame = await frameOf(overlay({ move: settled }), 80)

    expect(frame).toContain('✓ packing the work')
    expect(frame).not.toContain('uploading workspace')
  })

  it('keeps the meter under the row that failed', async () => {
    const failed = failMove({ move: moveWith(reading()), reason: 'upload dropped' })
    const frame = await frameOf(overlay({ move: failed }), 80)

    expect(frame).toContain('✗ packing the work')
    expect(frame).toContain('uploading workspace')
    expect(frame).toContain('upload dropped')
  })
})

describe('a transfer at narrow widths', () => {
  it('keeps the percentage and a size at 40 columns', async () => {
    const frame = await frameOf(overlay({ move: moveWith(reading()), width: 40 }), 40)

    expect(frame).toContain('25%')
    expect(frame).toContain('MiB')
    expect(frame).toContain('uploading')
  })

  it('keeps the percentage at 24 columns without spilling', async () => {
    const move = moveWith(reading())
    const frame = await frameOf(overlay({ move, width: 24 }), 24)

    expect(frame).toContain('25%')
    for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(24)
    await expect(mount(overlay({ move, width: 24 }), 24)).resolves.toBeUndefined()
  }, 60_000)
})

describe('the meter arithmetic', () => {
  const transfer = (over: Partial<RelocationTransferProgress> = {}) => {
    const { nodeId, transferId, label, transferredBytes, totalBytes, complete } = reading(over)
    return { nodeId, transferId, label, transferredBytes, totalBytes, complete }
  }

  it('clamps the percentage between 0 and 100', () => {
    expect(transferPercent(transfer({ transferredBytes: -5 }))).toBe(0)
    expect(transferPercent(transfer({ transferredBytes: 50 * MIB }))).toBe(100)
  })

  it('has no percentage without a usable total', () => {
    expect(transferPercent(transfer({ totalBytes: undefined }))).toBeNull()
    expect(transferPercent(transfer({ totalBytes: Number.NaN }))).toBeNull()
  })

  it('formats sizes by unit', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KiB')
    expect(formatBytes(3 * 1024 * MIB)).toBe('3.0 GiB')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })

  it('never lays out wider than the cells it was given', () => {
    for (const cells of [10, 16, 20, 24, 36, 60]) {
      const width = transferSpans({ transfer: transfer(), cells }).reduce(
        (sum, span) => sum + [...span.text].length,
        0,
      )
      expect(width).toBeLessThanOrEqual(cells)
    }
  })
})
