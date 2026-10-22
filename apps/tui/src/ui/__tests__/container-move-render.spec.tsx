import { describe, expect, it } from 'bun:test'
import React from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'

import {
  activateMoveRow,
  beginMove,
  expandMove,
  failMove,
  settleMoveNode,
  startMoveNode,
  type ContainerMove,
} from '../../composition/container-move'
import { ROTATE_HEADING } from '../../composition/cloud/cloud-runner'
import { WAKE_HEADING } from '../../composition/container-move'
import { ContainerMoveOverlay } from '../components/container-move'
import { frameOf, mount } from './transcript-fixture'

const STARTED_AT = 10_000

const BIRTH_ROWS = [
  { id: 'provision', text: 'waiting for the pod', nodeIds: ['provision'] },
  { id: 'attach', text: 'setting up the workspace', nodeIds: ['attach', 'open', 'flipOwnership'] },
] as const

const WAKE_ROWS = [
  { id: 'waiting', text: 'waiting for the pod', nodeIds: ['waiting'] },
  { id: 'attaching', text: 'attaching and verifying the conversation', nodeIds: ['attaching'] },
] as const

const cloudMove = (over: { settleThrough?: number; fail?: string } = {}): ContainerMove => {
  let move = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT, rows: BIRTH_ROWS })
  const through = over.settleThrough ?? 0
  const order = ['provision', 'attach']
  for (const nodeId of order.slice(0, through)) {
    move = settleMoveNode({ move, nodeId, now: STARTED_AT + 1_000 })
  }
  const nextPending = move.rows.find((row) => row.mark === 'pending')
  if (nextPending !== undefined) {
    move = startMoveNode({ move, nodeId: nextPending.nodeIds[0] ?? nextPending.id, now: STARTED_AT + 4_000 })
  }
  return over.fail === undefined ? move : failMove({ move, reason: over.fail })
}

const overlay = (args: { move: ContainerMove; now?: number }) => (
  <ContainerMoveOverlay
    move={args.move}
    now={args.now ?? STARTED_AT + 12_000}
    width={80}
    onDismiss={() => undefined}
  />
)

describe('a move while it runs', () => {
  it('names where the conversation is going and lists every row', async () => {
    const frame = await frameOf(overlay({ move: cloudMove() }), 80)

    expect(frame).toContain('STARTING A POD')
    expect(frame).toContain('waiting for the pod')
    expect(frame).toContain('setting up the workspace')
  })

  it('ticks the row it is on so a long wait reads as work', async () => {
    const frame = await frameOf(overlay({ move: cloudMove() }), 80)

    expect(frame).toContain('waiting for the pod (8s)')
  })

  it('never counts backwards when the clock lags the row', async () => {
    const frame = await frameOf(
      overlay({ move: cloudMove(), now: STARTED_AT }),
      80,
    )

    expect(frame).toContain('waiting for the pod (0s)')
    expect(frame).not.toContain('(-')
  })

  it('checks off the rows it finished and moves on to the next', async () => {
    const frame = await frameOf(overlay({ move: cloudMove({ settleThrough: 1 }) }), 80)

    expect(frame).toContain('✓ waiting for the pod')
    expect(frame).toContain('setting up the workspace (8s)')
  })

  it('rises from the bottom ruled off across the whole width', async () => {
    const rows = (await frameOf(overlay({ move: cloudMove() }), 80)).replace(/\n$/, '').split('\n')
    const edge = rows.findIndex((row) => row.trimEnd().startsWith('─'))

    expect(edge).toBeGreaterThan(rows.length / 2)
    expect((rows[edge] ?? '').trimEnd()).toHaveLength(80)
  })

  it('mounts at a narrow width without spilling', async () => {
    await expect(
      mount(
        <ContainerMoveOverlay
          move={cloudMove()}
          now={STARTED_AT + 3_000}
          width={40}
          onDismiss={() => undefined}
        />,
        40,
      ),
    ).resolves.toBeUndefined()
  }, 60_000)
})

describe('a wake that rotates the sandbox first', () => {
  const rotatingMove = (): ContainerMove => {
    const begun = beginMove({
      target: EExecutionLocation.Cloud,
      rows: WAKE_ROWS,
      heading: WAKE_HEADING,
      now: STARTED_AT,
    })
    const waiting = activateMoveRow({ move: begun, id: 'waiting', now: STARTED_AT + 1_000 })
    return expandMove({
      move: waiting,
      insertBefore: 'attaching',
      row: { id: 'rotating', text: 'updating the pod', nodeIds: ['rotating'] },
      heading: ROTATE_HEADING,
      now: STARTED_AT + 4_000,
    })
  }

  it('names the update and checks off the wait behind it', async () => {
    const frame = await frameOf(overlay({ move: rotatingMove() }), 80)

    expect(frame).toContain('UPDATING THE POD')
    expect(frame).toContain('✓ waiting for the pod')
    expect(frame).toContain('updating the pod (8s)')
    expect(frame).toContain('· attaching and verifying the conversation')
  })

  it('reads as one continuous move rather than a second one', async () => {
    const frame = await frameOf(overlay({ move: rotatingMove() }), 80)

    expect(frame).not.toContain('WAKING THE POD')
  })

  it('advances past the rotation once the sandbox answers again', async () => {
    const attached = activateMoveRow({
      move: rotatingMove(),
      id: 'attaching',
      now: STARTED_AT + 9_000,
    })
    const frame = await frameOf(overlay({ move: attached }), 80)

    expect(frame).toContain('✓ updating the pod')
    expect(frame).toContain('attaching and verifying the conversation (3s)')
  })

  it('leaves the rows alone when asked to insert before one it does not hold', async () => {
    const begun = beginMove({ target: EExecutionLocation.Cloud, rows: WAKE_ROWS, now: STARTED_AT })
    const expanded = expandMove({
      move: begun,
      insertBefore: 'missing',
      row: { id: 'rotating', text: 'updating the pod', nodeIds: ['rotating'] },
      now: STARTED_AT + 1_000,
    })

    expect(expanded.rows.map((row) => row.id)).toEqual(['waiting', 'attaching'])
  })

  it('never inserts the same row twice', async () => {
    const twice = expandMove({
      move: rotatingMove(),
      insertBefore: 'attaching',
      row: { id: 'rotating', text: 'updating the pod', nodeIds: ['rotating'] },
      now: STARTED_AT + 6_000,
    })

    expect(twice.rows.filter((row) => row.id === 'rotating')).toHaveLength(1)
  })
})

describe('a move that did not finish', () => {
  it('crosses out the row it died on and says why', async () => {
    const frame = await frameOf(
      overlay({ move: cloudMove({ settleThrough: 1, fail: 'no capacity in iad1' }) }),
      80,
    )

    expect(frame).toContain('✗ setting up the workspace')
    expect(frame).toContain('no capacity in iad1')
  })

  it('offers a way back to the conversation', async () => {
    const frame = await frameOf(
      overlay({ move: cloudMove({ settleThrough: 3, fail: 'no capacity in iad1' }) }),
      80,
    )

    expect(frame).toContain('esc')
  })

  it('stops ticking once it has settled', async () => {
    const frame = await frameOf(
      overlay({ move: cloudMove({ settleThrough: 3, fail: 'no capacity in iad1' }) }),
      80,
    )

    expect(frame).not.toContain('(8s)')
  })
})
