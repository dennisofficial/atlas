import { ERetryReason } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { afterAll, describe, expect, test } from 'bun:test'
import React from 'react'

import { subscribeTicker } from '../../hooks/use-shimmer-clock'
import { SHIMMER_TICK_MS } from '../../shimmer-frames'
import { ShimmerLine } from '../shimmer-line'
import { WorkingLine, EWorkingVerb } from '../working-line'

const QUIET_MS = 400

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const shimmerTicksPass = (count: number): Promise<void> =>
  new Promise((resolve) => {
    let seen = 0
    const stop = subscribeTicker({
      intervalMs: SHIMMER_TICK_MS,
      onTick: () => {
        seen += 1
        if (seen < count) return
        stop()
        resolve()
      },
    })
  })

type Setup = Awaited<ReturnType<typeof testRender>>

const mounted: Setup[] = []

afterAll(async () => {
  for (const setup of mounted) setup.renderer.destroy()
})

/**
 * The shimmer is the working cue across many tiles, so it runs in every one of them — which is why
 * a tick must be a write into the text buffer and never a React render.
 */
describe('a shimmer line left running', () => {
  test('keeps drawing frames without re-rendering its component', async () => {
    let renders = 0
    const Counted = (props: { elapsedMs: number; outputTokens: number }): React.ReactNode => {
      renders += 1
      return (
        <WorkingLine
          elapsedMs={props.elapsedMs}
          outputTokens={props.outputTokens}
          interrupting={false}
          verb={EWorkingVerb.Thinking}
        />
      )
    }
    const setup = await testRender(<Counted elapsedMs={1000} outputTokens={100} />, {
      width: 100,
      height: 10,
    })
    mounted.push(setup)
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    await setup.flush()

    expect(setup.captureCharFrame()).toContain('Thinking for 1s')

    const framesBefore = setup.renderer.getStats().frameCount
    const rendersBefore = renders
    await sleep(QUIET_MS)
    const frames = setup.renderer.getStats().frameCount - framesBefore

    expect(frames).toBeGreaterThan(3)
    expect(renders).toBe(rendersBefore)
  })

  test('stops drawing once the line is gone', async () => {
    let paints = 0
    let hide: () => void = () => undefined
    const Toggled = (): React.ReactNode => {
      const [shown, setShown] = React.useState(true)
      hide = () => setShown(false)
      if (!shown) return null
      return (
        <ShimmerLine
          label={() => {
            paints += 1
            return 'Thinking'
          }}
        />
      )
    }
    const setup = await testRender(<Toggled />, { width: 100, height: 10 })
    mounted.push(setup)
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    await setup.flush()
    await shimmerTicksPass(2)
    expect(paints).toBeGreaterThan(1)

    hide()
    await setup.flush()
    const paintsWhenGone = paints
    await shimmerTicksPass(3)

    expect(setup.captureCharFrame()).not.toContain('Thinking')
    expect(paints).toBe(paintsWhenGone)
  })

  test('paints nothing into a torn-down renderer with a tick still owed', async () => {
    let paints = 0
    const setup = await testRender(
      <ShimmerLine
        label={() => {
          paints += 1
          return 'Thinking'
        }}
      />,
      { width: 100, height: 10 },
    )
    await setup.flush()

    setup.renderer.destroy()
    const paintsAtTeardown = paints
    await shimmerTicksPass(3)

    expect(paints).toBe(paintsAtTeardown)
  })

  test('shows the retry countdown in the error colour', async () => {
    const setup = await testRender(
      <WorkingLine
        elapsedMs={1000}
        outputTokens={0}
        interrupting={false}
        retry={{
          attempt: 2,
          maxAttempts: 5,
          delayMs: 30_000,
          reason: ERetryReason.RateLimited,
          startedAt: Date.now(),
        }}
      />,
      { width: 100, height: 10 },
    )
    mounted.push(setup)
    await setup.flush()
    const frame = setup.captureCharFrame()
    expect(frame).toMatch(/retry/i)
  })

  test('reads disconnected with a resume-colored reconnect affordance and no shimmer', async () => {
    const setup = await testRender(
      <WorkingLine
        elapsedMs={1000}
        outputTokens={0}
        interrupting={false}
        verb={EWorkingVerb.Disconnected}
        onReconnect={() => undefined}
      />,
      { width: 100, height: 10 },
    )
    mounted.push(setup)
    await setup.flush()
    const frame = setup.captureCharFrame()
    expect(frame).toContain('disconnected')
    expect(frame).toContain('ctrl+r')
    expect(frame).toContain('reconnect')
    expect(frame).not.toContain('Thinking')
    expect(frame).not.toContain('Working')
  })
})
