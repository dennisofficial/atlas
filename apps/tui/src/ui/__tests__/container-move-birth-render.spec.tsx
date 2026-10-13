import { describe, expect, it } from 'bun:test'
import React from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'
import type { RelocationTransferProgress } from '@dltech/atlas-harness'

import { beginMove, failMove, startMoveNode, updateMoveTransfer, type ContainerMove } from '../../composition/container-move'
import { updateMoveBuild } from '../../composition/container-move-birth'
import { ContainerMoveOverlay } from '../components/container-move'
import { frameOf } from './transcript-fixture'

const STARTED_AT = 10_000
const MIB = 1024 * 1024

const ROWS = [
  { id: 'capture', text: 'packing the uncommitted work', nodeIds: ['captureWorkspace'] },
  { id: 'provision', text: 'waiting for the sandbox', nodeIds: ['provision'] },
] as const

const upload = (over: Partial<RelocationTransferProgress> = {}): RelocationTransferProgress => ({
  nodeId: 'provision',
  transferId: 'workspace-upload',
  label: 'uploading workspace',
  transferredBytes: 12 * MIB,
  totalBytes: 38 * MIB,
  complete: false,
  ...over,
})

const birth = (): ContainerMove => {
  const begun = beginMove({
    target: EExecutionLocation.Cloud,
    now: STARTED_AT,
    rows: ROWS,
    heading: 'STARTING A CLOUD SANDBOX',
    cancellable: true,
  })
  return startMoveNode({ move: begun, nodeId: 'captureWorkspace', now: STARTED_AT })
}

const frame = (args: { move: ContainerMove; elapsedMs: number }) =>
  frameOf(
    <ContainerMoveOverlay
      move={args.move}
      now={STARTED_AT + args.elapsedMs}
      width={90}
      onDismiss={() => undefined}
    />,
    90,
  )

describe('the birth overlay', () => {
  it('counts elapsed time up and offers cancel with the draft kept', async () => {
    const early = await frame({ move: birth(), elapsedMs: 3_000 })
    const later = await frame({ move: birth(), elapsedMs: 47_000 })

    expect(early).toContain('elapsed 3s')
    expect(later).toContain('elapsed 47s')
    expect(early).toContain('esc')
    expect(early).toContain('cancel and keep the draft')
  })

  it('shows what capture is actually moving', async () => {
    const move = updateMoveBuild({ move: birth(), progress: { phase: 'staging', files: 1204, bytes: 0 } })
    const text = await frame({ move, elapsedMs: 2_000 })

    expect(text).toContain('capturing workspace')
    expect(text).toContain('1,204 files')
  })

  it('shows capture bytes when the build reports them', async () => {
    const move = updateMoveBuild({
      move: birth(),
      progress: { phase: 'compressing', files: 1204, bytes: 8 * MIB, totalBytes: 38 * MIB },
    })
    const text = await frame({ move, elapsedMs: 2_000 })

    expect(text).toContain('compressing workspace')
    expect(text).toContain('8.0 MiB of 38.0 MiB')
  })

  it('shows the upload bytes while provisioning', async () => {
    let move = startMoveNode({ move: birth(), nodeId: 'provision', now: STARTED_AT })
    move = updateMoveTransfer({ move, progress: upload() })
    const text = await frame({ move, elapsedMs: 20_000 })

    expect(text).toContain('uploading workspace')
    expect(text).toContain('12.0 MiB / 38.0 MiB')
  })

  it('names the serve launch once the uploads have landed', async () => {
    let move = startMoveNode({ move: birth(), nodeId: 'provision', now: STARTED_AT })
    move = updateMoveTransfer({
      move,
      progress: upload({ transferredBytes: 38 * MIB, complete: true }),
    })
    const text = await frame({ move, elapsedMs: 40_000 })

    expect(text).toContain('starting serve')
  })

  it('swaps the cancel hint for the failure reason and a dismiss hint', async () => {
    const move = failMove({ move: birth(), reason: 'the sandbox would not start — this thread started on this machine instead' })
    const text = await frame({ move, elapsedMs: 5_000 })

    expect(text).toContain('started on this machine instead')
    expect(text).toContain('carry on')
    expect(text).not.toContain('cancel and keep the draft')
    expect(text).not.toContain('elapsed')
  })
})
