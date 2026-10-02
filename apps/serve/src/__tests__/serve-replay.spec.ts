import { afterEach, describe, expect, it } from 'bun:test'

import { CHANNEL_PROTOCOL_VERSION, EServeFrame, EStepEnd } from '@dltech/atlas-harness'

import { connect } from './client'
import {
  hello,
  isStep,
  releaseServeSpec,
  seqsOf,
  start,
  stepIdsOf,
  textChunk,
  threadId,
  TOKEN,
} from './serve-spec-fixture'

afterEach(releaseServeSpec)

describe('startServe', () => {
  it('replays only the frames after a cursor it still holds', async () => {
    const { handle, app } = await start({})
    const publisher = app.channel.publisherFor({ threadId })
    publisher.onChunk(textChunk('one'))
    publisher.onChunk(textChunk('two'))

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: 0, lastEventSeq: 4 }))

    await client.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 2)
    expect(client.frames[0]).toEqual({
      kind: EServeFrame.Ready,
      seq: 3,
      protocol: CHANNEL_PROTOCOL_VERSION,
      turnInFlight: false,
    })
    expect(seqsOf(client.frames)).toEqual([1, 2])
  })

  it('tells a client with no cursor to re-read the log, then hands it the step in flight', async () => {
    const { handle, app } = await start({})
    const publisher = app.channel.publisherFor({ threadId })
    publisher.onChunk(textChunk('one'))
    publisher.onChunk(textChunk('two'))

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 9 }))

    await client.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 2)
    expect(client.frames[0]).toEqual({ kind: EServeFrame.Reload, sinceEventSeq: 9 })
    expect(client.frames[1]).toEqual({
      kind: EServeFrame.Ready,
      seq: 3,
      protocol: CHANNEL_PROTOCOL_VERSION,
      turnInFlight: false,
    })
    expect(seqsOf(client.frames)).toEqual([0, 1, 2])
  })

  it('tells a client whose cursor fell out of the ring to re-read the log', async () => {
    const { handle, app } = await start({ bufferSize: 2 })
    const publisher = app.channel.publisherFor({ threadId })
    for (const text of ['one', 'two', 'three']) publisher.onChunk(textChunk(text))

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: 0, lastEventSeq: 2 }))

    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    expect(client.frames[0]).toEqual({ kind: EServeFrame.Reload, sinceEventSeq: 2 })
  })

  it('replays the step in flight under a fresh id, and keeps that client on it', async () => {
    const { handle, app } = await start({})
    const publisher = app.channel.publisherFor({ threadId })
    publisher.onChunk(textChunk('one'))

    const live = await connect({ port: handle.port, token: TOKEN })
    live.send(hello({ channelCursor: 0, lastEventSeq: 0 }))
    await live.waitFor((frame) => frame.kind === EServeFrame.Ready)

    const reloaded = await connect({ port: handle.port, token: TOKEN })
    reloaded.send(hello({ channelCursor: null, lastEventSeq: 9 }))
    await reloaded.waitFor((frame) => isStep(frame, 'chunk'))

    const replayed = stepIdsOf(reloaded.frames)[0]
    expect(replayed).toBeDefined()
    expect(replayed).not.toBe(`${threadId}#1`)

    publisher.onChunk(textChunk('two'))
    publisher.close({ end: EStepEnd.Completed })
    await reloaded.waitFor((frame) => isStep(frame, 'step-ended'))
    await live.waitFor((frame) => isStep(frame, 'step-ended'))

    expect(new Set(stepIdsOf(reloaded.frames))).toEqual(new Set([replayed as string]))
    expect(new Set(stepIdsOf(live.frames))).toEqual(new Set([`${threadId}#1`]))
  })

  it('leaves a resumed client on the step id it already knows', async () => {
    const { handle, app } = await start({})
    const publisher = app.channel.publisherFor({ threadId })
    publisher.onChunk(textChunk('one'))
    publisher.onChunk(textChunk('two'))

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: 0, lastEventSeq: 4 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 2)

    expect(stepIdsOf(client.frames)).toEqual([`${threadId}#1`, `${threadId}#1`])
  })

  it('hands a reloaded client the working turn behind an idle step gap', async () => {
    const { handle, app } = await start({})
    const publisher = app.channel.publisherFor({ threadId })
    publisher.onChunk(textChunk('one'))
    publisher.close({ end: EStepEnd.Completed })
    publisher.turnWorking({ working: true })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))

    await client.waitFor((frame) => frame.kind === EServeFrame.Signal)
    expect(client.frames[0]).toEqual({ kind: EServeFrame.Reload, sinceEventSeq: 0 })
    expect(client.frames.at(-1)).toMatchObject({
      kind: EServeFrame.Signal,
      signal: { type: 'turn-working', working: true },
    })
  })

  it('heads a reloaded mid-step backfill with the working signal the step is under', async () => {
    const { handle, app } = await start({})
    const publisher = app.channel.publisherFor({ threadId })
    publisher.turnWorking({ working: true })
    publisher.onChunk(textChunk('one'))

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))

    await client.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 2)
    const workingAt = client.frames.findIndex(
      (frame) => frame.kind === EServeFrame.Signal && frame.signal.type === 'turn-working',
    )
    expect(workingAt).toBe(2)
    expect(client.frames[workingAt]).toMatchObject({
      signal: { type: 'turn-working', working: true },
    })
  })

  it('backfills nothing for a settled turn', async () => {
    const { handle, app } = await start({})
    const publisher = app.channel.publisherFor({ threadId })
    publisher.turnWorking({ working: true })
    publisher.onChunk(textChunk('one'))
    publisher.close({ end: EStepEnd.Completed })
    publisher.turnWorking({ working: false })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))

    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    await Bun.sleep(10)
    expect(client.frames.map((frame) => frame.kind)).toEqual([
      EServeFrame.Reload,
      EServeFrame.Ready,
    ])
  })

  it('never backfills a step whose start has aged out of the ring', async () => {
    const { handle, app } = await start({ bufferSize: 2 })
    const publisher = app.channel.publisherFor({ threadId })
    for (const text of ['one', 'two', 'three']) publisher.onChunk(textChunk(text))

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 3 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    await Bun.sleep(10)

    expect(client.frames.map((frame) => frame.kind)).toEqual([
      EServeFrame.Reload,
      EServeFrame.Ready,
    ])

    publisher.onChunk(textChunk('four'))
    await client.waitFor((frame) => isStep(frame, 'chunk'))

    expect(stepIdsOf(client.frames)[0]).not.toBe(`${threadId}#1`)
  })

  it('forwards live signals in order under a monotonic seq', async () => {
    const { handle, app } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    const publisher = app.channel.publisherFor({ threadId })
    for (const text of ['one', 'two', 'three']) publisher.onChunk(textChunk(text))

    await client.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 3)
    expect(seqsOf(client.frames)).toEqual([0, 1, 2, 3])
  })
})
