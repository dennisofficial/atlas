import { afterEach, describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'

import {
  EClientFrame,
  EClientRequest,
  EServeFrame,
  ETurnStatus,
} from '@dltech/atlas-harness'

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
  it('answers a request while a turn is streaming', async () => {
    const held = gate()
    const { handle, app } = await start({
      entries: {
        'src/': [
          { name: 'channel', isDirectory: true },
          { name: 'chunk.ts', isDirectory: false },
          { name: 'other.ts', isDirectory: false },
        ],
      },
      runTurn: async () => {
        const publisher = app.channel.publisherFor({ threadId })
        publisher.onChunk(textChunk('one'))
        await held.opened
        publisher.onChunk(textChunk('two'))
        return { status: ETurnStatus.Completed, runId: toRunId('run-1') }
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Send, sendId: 'send-go' as never, text: 'go' })
    await client.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 1)

    client.send({
      kind: EClientFrame.Request,
      id: 'ask-1',
      op: EClientRequest.CompletePaths,
      params: { query: 'src/ch' },
    })
    const reply = await client.waitFor((frame) => frame.kind === EServeFrame.Reply)

    expect(reply).toEqual({
      kind: EServeFrame.Reply,
      replyTo: 'ask-1',
      ok: true,
      data: {
        directory: 'src/',
        fragment: 'ch',
        entries: [
          { name: 'channel', isDirectory: true },
          { name: 'chunk.ts', isDirectory: false },
        ],
      },
    })

    held.open()
    await client.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.seq === 2)
    expect(app.appended).toEqual([{ type: 'user-said', text: 'go' }])
  })

  it('commits a send with images and context exactly as a local turn would', async () => {
    const { handle, app } = await start({})

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({
      kind: EClientFrame.Send,
      sendId: 'send-img' as never,
      text: 'go',
      images: [{ path: '/tmp/shot.png', mediaType: 'image/png', data: 'aGVsbG8=', width: 2, height: 1 }],
      context: [{ type: 'context-loaded', slot: 'skill', key: 'commit', content: 'commit prose' }],
    })
    await Bun.sleep(20)

    expect(app.appended).toEqual([
      { type: 'context-loaded', slot: 'skill', key: 'commit', content: 'commit prose' },
      {
        type: 'user-said',
        text: 'go',
        images: [
          { path: '/tmp/shot.png', mediaType: 'image/png', data: 'aGVsbG8=', width: 2, height: 1 },
        ],
      },
    ])
  })

  it('acknowledges a send once the message is committed to the log', async () => {
    const { handle, app } = await start({})

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Send, sendId: 'send-ack-1' as never, text: 'go' })
    const ack = await client.waitFor((frame) => frame.kind === EServeFrame.SendAcked)

    expect(ack).toEqual({ kind: EServeFrame.SendAcked, sendId: 'send-ack-1' as never })
    expect(app.appended).toEqual([{ type: 'user-said', text: 'go' }])
  })

  it('acknowledges a re-driven sendId without committing the message twice', async () => {
    const { handle, app } = await start({})

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    const frame = { kind: EClientFrame.Send, sendId: 'send-dup' as never, text: 'go' } as const
    client.send(frame)
    await client.waitFor(
      (f) => f.kind === EServeFrame.SendAcked && f.sendId === 'send-dup',
    )

    client.send({ ...frame })
    await Bun.sleep(30)

    const acks = client.frames.filter((f) => f.kind === EServeFrame.SendAcked)
    expect(acks).toHaveLength(2)
    expect(app.appended).toEqual([{ type: 'user-said', text: 'go' }])
  })

  it('refuses a send whose context draft is not an event body rather than committing it', async () => {
    const { handle, app } = await start({})

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({
      kind: EClientFrame.Send,
      sendId: 'send-badcontext' as never,
      text: 'go',
      context: [{ type: 'context-loaded', slot: 'skill' }],
    })
    const refusal = await client.waitFor((frame) => frame.kind === EServeFrame.Error)

    expect(refusal.kind === EServeFrame.Error ? refusal.message : '').toContain('event body')
    expect(app.appended).toEqual([])
  })

})
