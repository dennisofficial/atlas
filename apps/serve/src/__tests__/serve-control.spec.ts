import { afterEach, describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'

import { EClientFrame, EServeFrame, ETurnStatus, type TurnOutcome } from '@dltech/atlas-harness'
import { EWorkspaceState, startServe } from '../index'

import { connect } from './client'
import { fakeServeApp } from './fakes'
import {
  CONTROL_PLANE,
  gate,
  hello,
  releaseServeSpec,
  start,
  threadId,
  TOKEN,
} from './serve-spec-fixture'

afterEach(releaseServeSpec)

describe('startServe', () => {
  it('interrupts the turn a client asked it to stop', async () => {
    let aborted = false
    const { handle } = await start({
      runTurn: async ({ signal }) => {
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()))
        aborted = true
        return { status: ETurnStatus.Interrupted, runId: toRunId('run-1'), committed: false }
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Send, sendId: 'send-go' as never, text: 'go' })
    await Bun.sleep(10)
    client.send({ kind: EClientFrame.Interrupt })

    const acked = await client.waitFor((frame) => frame.kind === EServeFrame.InterruptAcked)
    if (acked.kind === EServeFrame.InterruptAcked) expect(acked.seq).toBeGreaterThanOrEqual(0)
    expect(aborted).toBe(true)
  })

  it('halts the turn it is driving when a pause frame arrives', async () => {
    const halt = gate()
    let pausedSeen: boolean | undefined
    const { handle } = await start({
      runTurn: async ({ pause }) => {
        await pause?.waitIfPaused()
        pausedSeen = true
        await halt.opened
        return { status: ETurnStatus.RelocationPaused, runId: toRunId('run-1') }
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Send, sendId: 'send-go' as never, text: 'go' })
    await Bun.sleep(10)
    client.send({ kind: EClientFrame.Pause })
    await Bun.sleep(10)
    expect(pausedSeen).toBe(true)

    halt.open()
    await client.waitFor(
      (frame) =>
        frame.kind === EServeFrame.TurnEnded && frame.outcome.status === ETurnStatus.RelocationPaused,
    )
  })

  it('lets a paused turn finish once the resume frame lands', async () => {
    let resumed = false
    const { handle } = await start({
      runTurn: async ({ pause }) => {
        await pause?.waitIfPaused()
        resumed = true
        return { status: ETurnStatus.Completed, runId: toRunId('run-1') }
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Run })
    await Bun.sleep(10)
    client.send({ kind: EClientFrame.Pause })
    await Bun.sleep(10)
    client.send({ kind: EClientFrame.Resume })

    await client.waitFor(
      (frame) => frame.kind === EServeFrame.TurnEnded && frame.outcome.status === ETurnStatus.Completed,
    )
    expect(resumed).toBe(true)
  })

  it('gives up draining a step that ignores its abort, once the drain deadline lapses', async () => {
    const app = fakeServeApp({
      threadId,
      root: '/workspace',
      runTurn: () => new Promise<TurnOutcome>(() => undefined),
    })

    const handle = await startServe({
      threadId,
      port: 0,
      token: TOKEN,
      controlPlaneUrl: CONTROL_PLANE,
      env: {},
      cwd: '/workspace',
      compose: async () => app,
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      fetchFn: (async (_input: unknown) => new Response(null, { status: 204 })) as typeof fetch,
      drainDeadlineMs: 5,
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Run })
    await Bun.sleep(10)

    const startedAt = Date.now()
    await handle.close()

    expect(Date.now() - startedAt).toBeLessThan(200)
  })
})
