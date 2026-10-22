import { afterEach, describe, expect, it } from 'bun:test'

import { CHANNEL_PROTOCOL_VERSION, EClientFrame, EServeFrame } from '@dltech/atlas-harness'

import { connect } from './client'
import { hello, releaseServeSpec, start, threadId, TOKEN } from './serve-spec-fixture'

afterEach(releaseServeSpec)

describe('startServe', () => {
  it('refuses a websocket upgrade carrying the wrong token', async () => {
    const { handle } = await start({})

    await expect(connect({ port: handle.port, token: 'not-the-token' })).rejects.toThrow()
  })

  it('answers health only for the session token', async () => {
    const { handle } = await start({})
    const url = `http://127.0.0.1:${handle.port}/v1/health`

    expect((await fetch(url)).status).toBe(401)

    const allowed = await fetch(url, { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(allowed.status).toBe(200)
    expect(await allowed.json()).toMatchObject({ ok: true, threadId, turnRunning: false })
  })

  it('parks attached clients: broadcasts the reason, then closes them cleanly at 1001', async () => {
    const { handle, lines } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    const response = await fetch(`http://127.0.0.1:${handle.port}/v1/park`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'the sandbox parked after sitting idle' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    const parked = await client.waitFor((frame) => frame.kind === EServeFrame.Parked)
    expect(parked).toEqual({
      kind: EServeFrame.Parked,
      reason: 'the sandbox parked after sitting idle',
    })
    expect(await client.closed).toBe(1001)
    expect(lines.some((line) => line.includes('serve.clients-parked'))).toBe(true)
  })

  it('refuses a park request without the session token', async () => {
    const { handle } = await start({})

    const response = await fetch(`http://127.0.0.1:${handle.port}/v1/park`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'the sandbox was stopped' }),
    })

    expect(response.status).toBe(401)
  })

  it('rejects a park request missing a reason and never touches attached clients', async () => {
    const { handle } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    const response = await fetch(`http://127.0.0.1:${handle.port}/v1/park`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
    await Bun.sleep(10)
    expect(client.frames.some((frame) => frame.kind === EServeFrame.Parked)).toBe(false)
  })

  it('never sends a parked frame to a socket that has not said hello', async () => {
    const { handle } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })

    const response = await fetch(`http://127.0.0.1:${handle.port}/v1/park`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'the sandbox was stopped' }),
    })

    expect(response.status).toBe(200)
    await Bun.sleep(10)
    expect(client.frames).toEqual([])
    client.close()
  })

  it('closes a socket whose first frame is not hello', async () => {
    const { handle } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })

    client.send({ kind: EClientFrame.Send, sendId: 'send-nohello' as never, text: 'hi' })

    expect(await client.closed).toBe(1008)
    expect(client.frames.at(-1)).toEqual({
      kind: EServeFrame.Error,
      message: 'the first frame must be hello',
    })
  })

  it('refuses a hello on a newer wire protocol, saying how to rebuild the serve', async () => {
    const { handle } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })

    client.send(hello({ channelCursor: null, lastEventSeq: 0, protocol: CHANNEL_PROTOCOL_VERSION + 1 }))

    expect(await client.closed).toBe(1008)
    const last = client.frames.at(-1)
    expect(last?.kind).toBe(EServeFrame.Error)
    if (last?.kind !== EServeFrame.Error) throw new Error('expected an error frame')
    expect(last.message).toContain('re-open the conversation')
  })

  it('refuses a hello on an older wire protocol, saying to update Atlas', async () => {
    const { handle } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })

    client.send(hello({ channelCursor: null, lastEventSeq: 0, protocol: CHANNEL_PROTOCOL_VERSION - 1 }))

    expect(await client.closed).toBe(1008)
    const last = client.frames.at(-1)
    expect(last?.kind).toBe(EServeFrame.Error)
    if (last?.kind !== EServeFrame.Error) throw new Error('expected an error frame')
    expect(last.message).toContain('update Atlas')
  })

  it('greets a hello too old to carry a protocol stamp', async () => {
    const { handle } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })

    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))

    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
  })
})
