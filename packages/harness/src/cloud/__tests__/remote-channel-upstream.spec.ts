import { describe, expect, it } from 'bun:test'

import { EClientFrame, EClientRequest, EServeFrame, type ClientFrame } from '../channel-wire'
import { RemoteRequestFailed, RemoteRequestLost } from '../remote-delta-channel'
import { harness, readied } from './remote-channel-fixture'

const upstreamOf = (sent: readonly ClientFrame[]): ClientFrame[] =>
  sent.filter((frame) => frame.kind !== EClientFrame.Hello)

describe('sending before the sandbox is ready', () => {
  it('queues the frames and flushes them in order once it is', () => {
    const { channel, open, receive, live } = harness()
    open()

    channel.send({ text: 'take a look at the router' })
    channel.interrupt()
    expect(upstreamOf(live().sent)).toEqual([])

    receive({ kind: EServeFrame.Ready, seq: 1 })

    expect(upstreamOf(live().sent)).toEqual([
      { kind: EClientFrame.Send, text: 'take a look at the router' },
      { kind: EClientFrame.Interrupt },
    ])
  })

  it('keeps a queued message across a reconnect and sends it on the next ready', () => {
    const { channel, open, drop, retries, receive, live } = harness()
    open()
    channel.send({ text: 'still want this' })

    drop()
    retries[0]?.run()
    live().handlers.handleOpen()
    receive({ kind: EServeFrame.Ready, seq: 9 })

    expect(upstreamOf(live().sent)).toEqual([
      { kind: EClientFrame.Send, text: 'still want this' },
    ])
  })
})

describe('sending on a ready socket', () => {
  it('writes the send and interrupt frames straight through', () => {
    const { channel, live } = readied()

    channel.send({ text: 'hello there' })
    channel.interrupt()

    expect(upstreamOf(live().sent)).toEqual([
      { kind: EClientFrame.Send, text: 'hello there' },
      { kind: EClientFrame.Interrupt },
    ])
  })

  it('answers a liveness ping with a pong', () => {
    const { ping, live } = readied()

    ping()

    expect(upstreamOf(live().sent)).toEqual([{ kind: EClientFrame.Pong }])
  })
})

describe('a request riding the session socket', () => {
  it('carries a correlation id and resolves with the reply payload', async () => {
    const { channel, receive, live } = readied()

    const answer = channel.request({
      op: EClientRequest.CompletePaths,
      params: { prefix: 'src/clo' },
    })
    const sent = upstreamOf(live().sent)[0]
    expect(sent).toMatchObject({
      kind: EClientFrame.Request,
      op: EClientRequest.CompletePaths,
      params: { prefix: 'src/clo' },
    })

    const id = sent?.kind === EClientFrame.Request ? sent.id : ''
    expect(id.length).toBeGreaterThan(0)
    receive({ kind: EServeFrame.Reply, replyTo: id, ok: true, data: ['src/cloud'] })

    expect(await answer).toEqual(['src/cloud'])
  })

  it('gives every request its own correlation id', () => {
    const { channel, live } = readied()

    void channel.request({ op: EClientRequest.CompletePaths, params: {} }).catch(() => undefined)
    void channel.request({ op: EClientRequest.BrowseDirectory, params: {} }).catch(() => undefined)

    const ids = upstreamOf(live().sent).flatMap((frame) =>
      frame.kind === EClientFrame.Request ? [frame.id] : [],
    )
    expect(new Set(ids).size).toBe(2)
  })

  it('rejects with the payload the sandbox refused it with', async () => {
    const { channel, receive, live } = readied()

    const answer = channel.request({ op: EClientRequest.BrowseDirectory, params: { path: '/nope' } })
    const sent = upstreamOf(live().sent)[0]
    const id = sent?.kind === EClientFrame.Request ? sent.id : ''
    receive({
      kind: EServeFrame.Reply,
      replyTo: id,
      ok: false,
      data: { message: 'no such directory' },
    })

    const failure = await answer.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RemoteRequestFailed)
    expect((failure as RemoteRequestFailed).data).toEqual({ message: 'no such directory' })
    expect((failure as RemoteRequestFailed).message).toContain('no such directory')
  })

  it('rejects when it times out rather than waiting forever', async () => {
    const { channel, timeouts } = readied({ requestTimeoutMs: 2_500 })

    const answer = channel.request({ op: EClientRequest.CompletePaths, params: {} })
    expect(timeouts[0]?.delayMs).toBe(2_500)
    timeouts[0]?.run()

    const failure = await answer.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RemoteRequestLost)
    expect((failure as RemoteRequestLost).message).toContain('2500ms')
  })

  it('rejects every request in flight when the socket closes', async () => {
    const { channel, drop } = readied()

    const answer = channel.request({ op: EClientRequest.CompletePaths, params: {} })
    drop()

    await expect(answer).rejects.toBeInstanceOf(RemoteRequestLost)
  })

  it('rejects every request in flight when the channel closes', async () => {
    const { channel } = readied()

    const answer = channel.request({ op: EClientRequest.CompletePaths, params: {} })
    channel.close()

    await expect(answer).rejects.toBeInstanceOf(RemoteRequestLost)
  })

  it('does not resend a request the reconnect already rejected', async () => {
    const { channel, drop, retries, receive, live } = harness()

    const answer = channel.request({ op: EClientRequest.CompletePaths, params: {} })
    await expect(
      (async () => {
        drop()
        return await answer
      })(),
    ).rejects.toBeInstanceOf(RemoteRequestLost)

    retries[0]?.run()
    live().handlers.handleOpen()
    receive({ kind: EServeFrame.Ready, seq: 2 })

    expect(upstreamOf(live().sent)).toEqual([])
  })

  it('ignores a reply that answers nothing it is waiting for', () => {
    const { receive } = readied()

    expect(() =>
      receive({ kind: EServeFrame.Reply, replyTo: 'req-404', ok: true, data: null }),
    ).not.toThrow()
  })
})
