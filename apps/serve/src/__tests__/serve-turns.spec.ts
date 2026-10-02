import { afterEach, describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'

import { EClientFrame, EServeFrame, ETurnStatus } from '@dltech/atlas-harness'
import { EServeEvent, EWorkspaceState, EWorkspaceStep } from '../index'

import { connect } from './client'
import {
  gate,
  hello,
  releaseServeSpec,
  start,
  textChunk,
  threadId,
  TOKEN,
} from './serve-spec-fixture'

afterEach(releaseServeSpec)

describe('startServe', () => {
  it('runs a turn from the log head on a run frame, commits nothing, and answers with the outcome', async () => {
    const { handle, app } = await start({
      runTurn: async () => ({ status: ETurnStatus.Completed, runId: toRunId('run-1') }),
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Run })
    const ended = await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)

    expect(ended).toEqual({
      kind: EServeFrame.TurnEnded,
      outcome: { status: ETurnStatus.Completed, runId: toRunId('run-1') },
    })
    expect(app.appended).toEqual([])
  })

  it('replays the turn-ended a disconnected client missed, settling its waiter before the next turn', async () => {
    const held = gate()
    let turns = 0
    const { handle, app, lines } = await start({
      runTurn: async () => {
        turns += 1
        const publisher = app.channel.publisherFor({ threadId })
        publisher.onChunk(textChunk('one'))
        if (turns === 1) await held.opened
        publisher.onChunk(textChunk('two'))
        return { status: ETurnStatus.Completed, runId: toRunId(`run-${turns}`) }
      },
    })

    const first = await connect({ port: handle.port, token: TOKEN })
    first.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await first.waitFor((frame) => frame.kind === EServeFrame.Ready)
    first.send({ kind: EClientFrame.Run })
    await first.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 1)
    first.close()
    await first.closed

    held.open()
    for (let waited = 0; waited < 2000; waited += 1) {
      if (lines.some((line) => line.includes(EServeEvent.TurnEnded))) break
      await Bun.sleep(1)
    }

    const second = await connect({ port: handle.port, token: TOKEN })
    second.send(hello({ channelCursor: 1, lastEventSeq: 0 }))
    const replayed = await second.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)

    expect(replayed).toEqual({
      kind: EServeFrame.TurnEnded,
      outcome: { status: ETurnStatus.Completed, runId: toRunId('run-1') },
    })
    expect(second.frames.map((frame) => frame.kind)).toEqual([
      EServeFrame.Ready,
      EServeFrame.Signal,
      EServeFrame.TurnEnded,
    ])

    second.send({ kind: EClientFrame.Run })
    await second.waitFor(
      (frame) => frame.kind === EServeFrame.TurnEnded && frame.outcome.runId === toRunId('run-2'),
    )
    expect(turns).toBe(2)
  })

  it('replays the error a disconnected client missed when its turn failed', async () => {
    const held = gate()
    const { handle, app, lines } = await start({
      runTurn: async () => {
        const publisher = app.channel.publisherFor({ threadId })
        publisher.onChunk(textChunk('one'))
        await held.opened
        throw new Error('the control plane answered 401')
      },
    })

    const first = await connect({ port: handle.port, token: TOKEN })
    first.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await first.waitFor((frame) => frame.kind === EServeFrame.Ready)
    first.send({ kind: EClientFrame.Run })
    await first.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 1)
    first.close()
    await first.closed

    held.open()
    for (let waited = 0; waited < 2000; waited += 1) {
      if (lines.some((line) => line.includes(EServeEvent.TurnFailed))) break
      await Bun.sleep(1)
    }

    const second = await connect({ port: handle.port, token: TOKEN })
    second.send(hello({ channelCursor: 1, lastEventSeq: 0 }))
    const failure = await second.waitFor((frame) => frame.kind === EServeFrame.Error)

    expect(failure).toEqual({ kind: EServeFrame.Error, message: 'the control plane answered 401' })
  })

  it('refuses a run frame that arrives mid-turn rather than queueing a second turn', async () => {
    const held = gate()
    let turns = 0
    const { handle } = await start({
      runTurn: async () => {
        turns += 1
        if (turns === 1) await held.opened
        return { status: ETurnStatus.Completed, runId: toRunId(`run-${turns}`) }
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Run })
    await Bun.sleep(10)
    client.send({ kind: EClientFrame.Run })
    const refusal = await client.waitFor((frame) => frame.kind === EServeFrame.Error)
    expect(JSON.stringify(refusal)).toContain('already running')

    held.open()
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
    await Bun.sleep(30)
    expect(turns).toBe(1)
  })

  it('runs another turn when a run frame arrives after the previous one settled', async () => {
    let turns = 0
    const { handle } = await start({
      runTurn: async () => {
        turns += 1
        return { status: ETurnStatus.Completed, runId: toRunId(`run-${turns}`) }
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Run })
    await client.waitFor(
      (frame) => frame.kind === EServeFrame.TurnEnded && frame.outcome.runId === 'run-1',
    )
    client.send({ kind: EClientFrame.Run })
    await client.waitFor(
      (frame) => frame.kind === EServeFrame.TurnEnded && frame.outcome.runId === 'run-2',
    )
    expect(turns).toBe(2)
  })

  it('refuses a run frame when the workspace failed to materialize', async () => {
    const { handle } = await start({
      workspace: {
        state: EWorkspaceState.Failed,
        step: EWorkspaceStep.Clone,
        reason: 'fatal: repository not found',
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    await client.waitFor((frame) => frame.kind === EServeFrame.Error)

    client.send({ kind: EClientFrame.Run })
    const refusal = await client.waitFor((frame) => frame.kind === EServeFrame.Error)
    expect(JSON.stringify(refusal)).toContain('fatal: repository not found')
  })

  it('answers a turn that throws with the reason, not silence', async () => {
    const { handle } = await start({
      runTurn: async () => {
        throw new Error('the control plane answered 401')
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Run })
    const failure = await client.waitFor((frame) => frame.kind === EServeFrame.Error)

    expect(failure).toEqual({ kind: EServeFrame.Error, message: 'the control plane answered 401' })
  })
})
