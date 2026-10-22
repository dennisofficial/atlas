import { describe, expect, it } from 'vitest'

import { EExecutionLocation } from '@dltech/atlas-core'
import type { BirthTransferProgress } from '@dltech/atlas-harness'

import {
  beginMove,
  failMove,
  startMoveNode,
  updateMoveTransfer,
  type ContainerMove,
} from '../../composition/container-move'
import { ContainerMoveOverlay } from '../components/container-move'
import { frameOf } from './transcript-fixture'

const STARTED_AT = 10_000
const MIB = 1024 * 1024

const ROWS = [
  { id: 'provision', text: 'waiting for the pod', nodeIds: ['provision'] },
  { id: 'attach', text: 'setting up the workspace', nodeIds: ['attach', 'open', 'flipOwnership'] },
] as const

const upload = (over: Partial<BirthTransferProgress> = {}): BirthTransferProgress => ({
  nodeId: 'provision',
  transferId: 'context-upload',
  label: 'uploading local config',
  transferredBytes: 12 * MIB,
  totalBytes: 38 * MIB,
  complete: false,
  ...over,
})

const birth = (): ContainerMove =>
  beginMove({
    target: EExecutionLocation.Cloud,
    now: STARTED_AT,
    rows: ROWS,
    heading: 'STARTING A POD',
    cancellable: true,
  })

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

  it('shows the upload bytes while provisioning', async () => {
    let move = startMoveNode({ move: birth(), nodeId: 'provision', now: STARTED_AT })
    move = updateMoveTransfer({ move, progress: upload() })
    const text = await frame({ move, elapsedMs: 20_000 })

    expect(text).toContain('uploading local config')
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
    const move = failMove({
      move: birth(),
      reason: 'the sandbox would not start — this thread started on this machine instead',
    })
    const text = await frame({ move, elapsedMs: 5_000 })

    expect(text).toContain('started on this machine instead')
    expect(text).toContain('carry on')
    expect(text).not.toContain('cancel and keep the draft')
    expect(text).not.toContain('elapsed')
  })
})
