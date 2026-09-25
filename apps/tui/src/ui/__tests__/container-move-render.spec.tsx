import { describe, expect, it } from 'bun:test'
import React from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'

import { ELiftStep } from '@dltech/atlas-harness'
import {
  advanceMove,
  beginMove,
  failMove,
  type ContainerMove,
} from '../../composition/container-move'
import { ContainerMoveOverlay } from '../components/container-move'
import { frameOf, mount } from './transcript-fixture'

const STARTED_AT = 10_000

const cloudMove = (over: { advanceTo?: ELiftStep; fail?: string } = {}): ContainerMove => {
  const begun = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT })
  const advanced =
    over.advanceTo === undefined
      ? begun
      : advanceMove({ move: begun, step: over.advanceTo, now: STARTED_AT + 4_000 })
  return over.fail === undefined ? advanced : failMove({ move: advanced, reason: over.fail })
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
  it('names where the conversation is going and lists every step', async () => {
    const frame = await frameOf(overlay({ move: cloudMove() }), 80)

    expect(frame).toContain('MOVING TO THE CLOUD')
    expect(frame).toContain('transferring the conversation')
    expect(frame).toContain('handing the conversation over')
    expect(frame).toContain('closing what is running here')
    expect(frame).toContain('packing the uncommitted work')
    expect(frame).toContain('waiting for the sandbox')
    expect(frame).toContain('attaching to the sandbox')
  })

  it('ticks the step it is on so a long wait reads as work', async () => {
    const frame = await frameOf(overlay({ move: cloudMove({ advanceTo: ELiftStep.Starting }) }), 80)

    expect(frame).toContain('waiting for the sandbox (8s)')
  })

  it('never counts backwards when the clock lags the step', async () => {
    const frame = await frameOf(
      overlay({ move: cloudMove({ advanceTo: ELiftStep.Starting }), now: STARTED_AT }),
      80,
    )

    expect(frame).toContain('waiting for the sandbox (0s)')
    expect(frame).not.toContain('(-')
  })

  it('checks off the steps it finished and dims the ones still coming', async () => {
    const frame = await frameOf(overlay({ move: cloudMove({ advanceTo: ELiftStep.Starting }) }), 80)

    expect(frame).toContain('✓ transferring the conversation')
    expect(frame).toContain('✓ packing the uncommitted work')
    expect(frame).toContain('· attaching to the sandbox')
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

describe('a move that did not finish', () => {
  it('crosses out the step it died on and says why', async () => {
    const frame = await frameOf(
      overlay({ move: cloudMove({ advanceTo: ELiftStep.Starting, fail: 'no capacity in iad1' }) }),
      80,
    )

    expect(frame).toContain('✗ waiting for the sandbox')
    expect(frame).toContain('no capacity in iad1')
  })

  it('offers a way back to the conversation', async () => {
    const frame = await frameOf(
      overlay({ move: cloudMove({ advanceTo: ELiftStep.Starting, fail: 'no capacity in iad1' }) }),
      80,
    )

    expect(frame).toContain('esc')
  })

  it('stops ticking once it has settled', async () => {
    const frame = await frameOf(
      overlay({ move: cloudMove({ advanceTo: ELiftStep.Starting, fail: 'no capacity in iad1' }) }),
      80,
    )

    expect(frame).not.toContain('(8s)')
  })
})
