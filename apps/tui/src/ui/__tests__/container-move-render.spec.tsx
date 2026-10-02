import { describe, expect, it } from 'bun:test'
import React from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'

import { ELiftStep } from '@dltech/atlas-harness'
import {
  advanceMove,
  beginMove,
  ELocalMoveStep,
  expandMove,
  failMove,
  type ContainerMove,
} from '../../composition/container-move'
import { ROTATE_HEADING } from '../../composition/cloud/cloud-runner'
import { WAKE_HEADING, WAKE_PLAN } from '../../composition/container-move'
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
    expect(frame).toContain('attaching and verifying the conversation')
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
    expect(frame).toContain('· attaching and verifying the conversation')
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
      plan: WAKE_PLAN,
      heading: WAKE_HEADING,
      now: STARTED_AT,
    })
    const waiting = advanceMove({ move: begun, step: ELiftStep.Starting, now: STARTED_AT + 1_000 })
    return expandMove({
      move: waiting,
      insertBefore: ELiftStep.Attaching,
      step: ELocalMoveStep.Rotating,
      heading: ROTATE_HEADING,
      now: STARTED_AT + 4_000,
    })
  }

  it('names the update and checks off the wait behind it', async () => {
    const frame = await frameOf(overlay({ move: rotatingMove() }), 80)

    expect(frame).toContain('UPDATING THE CLOUD SANDBOX')
    expect(frame).toContain('✓ waiting for the sandbox')
    expect(frame).toContain('updating the cloud sandbox (8s)')
    expect(frame).toContain('· attaching and verifying the conversation')
  })

  it('reads as one continuous move rather than a second one', async () => {
    const frame = await frameOf(overlay({ move: rotatingMove() }), 80)

    expect(frame).not.toContain('WAKING THE SANDBOX')
  })

  it('advances past the rotation once the sandbox answers again', async () => {
    const attached = advanceMove({
      move: rotatingMove(),
      step: ELiftStep.Attaching,
      now: STARTED_AT + 9_000,
    })
    const frame = await frameOf(overlay({ move: attached }), 80)

    expect(frame).toContain('✓ updating the cloud sandbox')
    expect(frame).toContain('attaching and verifying the conversation (3s)')
  })

  it('leaves the plan alone when asked to insert before a step it does not hold', async () => {
    const begun = beginMove({ target: EExecutionLocation.Cloud, plan: WAKE_PLAN, now: STARTED_AT })
    const expanded = expandMove({
      move: begun,
      insertBefore: ELiftStep.Flipping,
      step: ELocalMoveStep.Rotating,
      now: STARTED_AT + 1_000,
    })

    expect(expanded.steps.map((step) => step.id)).toEqual([...WAKE_PLAN])
  })

  it('never inserts the same step twice', async () => {
    const twice = expandMove({
      move: rotatingMove(),
      insertBefore: ELiftStep.Attaching,
      step: ELocalMoveStep.Rotating,
      now: STARTED_AT + 6_000,
    })

    expect(
      twice.steps.filter((step) => step.id === ELocalMoveStep.Rotating),
    ).toHaveLength(1)
  })
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
