import { describe, expect, it } from 'bun:test'

import { EClientFrame, EClientRequest, EServeFrame, type ClientFrame } from '../channel-wire'
import { RemoteRequestFailed, RemoteRequestLost } from '../remote-delta-channel'
import { harness, readied } from './remote-channel-fixture'

const upstreamOf = (sent: readonly ClientFrame[]): ClientFrame[] =>
  sent.filter((frame) => frame.kind !== EClientFrame.Hello)

type SendFrame = Extract<ClientFrame, { kind: EClientFrame.Send }>

const sendIdsOf = (sent: readonly ClientFrame[]): string[] =>
  sent.flatMap((frame) => (frame.kind === EClientFrame.Send ? [frame.sendId as string] : []))

const lastSendOf = (sent: readonly ClientFrame[]): SendFrame => {
  const found = [...sent].reverse().find((frame) => frame.kind === EClientFrame.Send)
  if (found === undefined || found.kind !== EClientFrame.Send) throw new Error('no send was written')
  return found
}

describe('sending before the sandbox is ready', () => {
  it('queues the frames and flushes them in order once it is', () => {
    const { channel, open, receive, live } = harness()
    open()

    channel.send({ text: 'take a look at the router' })
    channel.interrupt()
    expect(upstreamOf(live().sent)).toEqual([])

    receive({ kind: EServeFrame.Ready, seq: 1 })

    const flushed = upstreamOf(live().sent)
    expect(flushed[0]).toMatchObject({ kind: EClientFrame.Send, text: 'take a look at the router' })
    expect(flushed[1]).toEqual({ kind: EClientFrame.Interrupt })
  })

  it('keeps a queued message across a reconnect and sends it on the next ready', () => {
    const { channel, open, drop, retries, receive, live } = harness()
    open()
    channel.send({ text: 'still want this' })

    drop()
    retries[0]?.run()
    live().handlers.handleOpen()
    receive({ kind: EServeFrame.Ready, seq: 9 })

    const flushed = upstreamOf(live().sent)
    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toMatchObject({ kind: EClientFrame.Send, text: 'still want this' })
  })
})

describe('sending on a ready socket', () => {
  it('writes the send and interrupt frames straight through', () => {
    const { channel, live } = readied()

    channel.send({ text: 'hello there' })
    channel.interrupt()

    const sent = upstreamOf(live().sent)
    expect(sent[0]).toMatchObject({ kind: EClientFrame.Send, text: 'hello there' })
    expect(sent[1]).toEqual({ kind: EClientFrame.Interrupt })
  })

  it('stamps every send with its own correlation id', () => {
    const { channel, live } = readied()

    channel.send({ text: 'one' })
    channel.send({ text: 'two' })

    const ids = sendIdsOf(live().sent)
    expect(ids).toHaveLength(2)
    expect(ids.every((id) => id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })

  it('answers a liveness ping with a pong', () => {
    const { ping, live } = readied()

    ping()

    expect(upstreamOf(live().sent)).toEqual([{ kind: EClientFrame.Pong }])
  })
})

describe('a send the socket may have lost', () => {
  it('re-drives it on the next ready with the same sendId, since the ack never came', () => {
    const { channel, drop, retries, receive, live } = readied()

    channel.send({ text: 'committed nowhere yet' })
    const original = lastSendOf(live().sent)
    drop()

    retries[0]?.run()
    live().handlers.handleOpen()
    receive({ kind: EServeFrame.Ready, seq: 9 })

    const redriven = lastSendOf(live().sent)
    expect(redriven.sendId).toBe(original.sendId)
    expect(redriven.text).toBe('committed nowhere yet')
  })

  it('does not re-drive a send the serve acknowledged', () => {
    const { channel, drop, retries, receive, live } = readied()

    channel.send({ text: 'committed' })
    const original = lastSendOf(live().sent)
    receive({ kind: EServeFrame.SendAcked, sendId: original.sendId })
    drop()

    retries[0]?.run()
    live().handlers.handleOpen()
    receive({ kind: EServeFrame.Ready, seq: 9 })

    expect(sendIdsOf(live().sent)).toEqual([])
  })

  it('keeps two sends in order across a reconnect', () => {
    const { channel, drop, retries, receive, live } = readied()

    channel.send({ text: 'first' })
    channel.send({ text: 'second' })
    const originals = sendIdsOf(live().sent)
    drop()

    retries[0]?.run()
    live().handlers.handleOpen()
    receive({ kind: EServeFrame.Ready, seq: 9 })

    expect(sendIdsOf(live().sent)).toEqual(originals)
    const texts = upstreamOf(live().sent).flatMap((frame) =>
      frame.kind === EClientFrame.Send ? [frame.text] : [],
    )
    expect(texts).toEqual(['first', 'second'])
  })

  it('keeps a re-driven send ahead of frames written after the drop', () => {
    const { channel, drop, retries, receive, live } = readied()

    channel.send({ text: 'before the drop' })
    const original = lastSendOf(live().sent)
    drop()
    channel.interrupt()

    retries[0]?.run()
    live().handlers.handleOpen()
    receive({ kind: EServeFrame.Ready, seq: 9 })

    const flushed = upstreamOf(live().sent)
    expect(flushed[0]).toMatchObject({ kind: EClientFrame.Send, sendId: original.sendId })
    expect(flushed[1]).toEqual({ kind: EClientFrame.Interrupt })
  })

  it('does not re-drive a send once the channel closes on purpose', () => {
    const { channel, sockets, live } = readied()

    channel.send({ text: 'never landing' })
    channel.close()

    expect(sockets).toHaveLength(1)
    expect(sendIdsOf(live().sent)).toHaveLength(1)
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

  describe('the per-op timeout budget', () => {
    it('gives an ordinary read the default ten seconds', () => {
      const { channel, timeouts } = readied()

      void channel
        .request({ op: EClientRequest.ReadEvents, params: {} })
        .catch(() => undefined)

      expect(timeouts[0]?.delayMs).toBe(10_000)
    })

    it('gives the archive and identity ops two minutes, since extracts and digests outlast a read', () => {
      const { channel, timeouts } = readied()

      void channel.request({ op: EClientRequest.RestoreTranscript, params: {} }).catch(() => undefined)
      void channel.request({ op: EClientRequest.ReadSessionArchive, params: {} }).catch(() => undefined)
      void channel.request({ op: EClientRequest.ReadMemoryArchive, params: {} }).catch(() => undefined)
      void channel
        .request({ op: EClientRequest.ReadTranscriptIdentity, params: {} })
        .catch(() => undefined)

      expect(timeouts.map((timeout) => timeout.delayMs)).toEqual([120_000, 120_000, 120_000, 120_000])
    })

    it('lets an explicit requestTimeoutMs override the per-op default', () => {
      const { channel, timeouts } = readied({ requestTimeoutMs: 2_500 })

      void channel.request({ op: EClientRequest.RestoreTranscript, params: {} }).catch(() => undefined)
      void channel.request({ op: EClientRequest.ReadEvents, params: {} }).catch(() => undefined)

      expect(timeouts.map((timeout) => timeout.delayMs)).toEqual([2_500, 2_500])
    })

    it('fails closed when a restore on an old serve runs past the budget', async () => {
      const { channel, timeouts } = readied()

      const answer = channel.request({ op: EClientRequest.RestoreTranscript, params: {} })
      timeouts[0]?.run()

      const failure = await answer.catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(RemoteRequestLost)
      expect((failure as RemoteRequestLost).message).toContain('120000ms')
    })
  })

  describe('a read in flight when the socket closes', () => {
    it('keeps it pending and re-drives it on the next ready', async () => {
      const { channel, drop, retries, receive, live } = readied()

      const answer = channel.request({ op: EClientRequest.CompletePaths, params: { prefix: 'src/clo' } })
      const first = upstreamOf(live().sent).find((frame) => frame.kind === EClientFrame.Request)
      drop()

      let settled = false
      void answer.then(
        () => (settled = true),
        () => (settled = true),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(settled).toBe(false)

      retries[0]?.run()
      live().handlers.handleOpen()
      receive({ kind: EServeFrame.Ready, seq: 9 })

      const resent = upstreamOf(live().sent).filter((frame) => frame.kind === EClientFrame.Request)
      expect(resent).toHaveLength(1)
      expect(resent[0]).toMatchObject({
        op: EClientRequest.CompletePaths,
        params: { prefix: 'src/clo' },
      })
      const id = resent[0]?.kind === EClientFrame.Request ? resent[0].id : ''
      expect(id).toBe(first?.kind === EClientFrame.Request ? first.id : '')

      receive({ kind: EServeFrame.Reply, replyTo: id, ok: true, data: ['src/cloud'] })
      expect(await answer).toEqual(['src/cloud'])
    })

    it('re-drives a read that was queued but never sent', async () => {
      const { channel, drop, retries, receive, live } = readied()

      channel.send({ text: 'ahead of it' })
      const answer = channel.request({ op: EClientRequest.ReadThread, params: { threadId: 'brn_cloud' } })
      drop()

      retries[0]?.run()
      live().handlers.handleOpen()
      receive({ kind: EServeFrame.Ready, seq: 9 })

      const resent = upstreamOf(live().sent).filter((frame) => frame.kind === EClientFrame.Request)
      expect(resent).toHaveLength(1)
      const id = resent[0]?.kind === EClientFrame.Request ? resent[0].id : ''
      receive({ kind: EServeFrame.Reply, replyTo: id, ok: true, data: { thread: null } })
      expect(await answer).toEqual({ thread: null })
    })

    it('can still time out while it waits out the reconnect', async () => {
      const { channel, drop, timeouts } = readied({ requestTimeoutMs: 2_500 })

      const answer = channel.request({ op: EClientRequest.ReadEvents, params: {} })
      drop()
      timeouts[0]?.run()

      await expect(answer).rejects.toBeInstanceOf(RemoteRequestLost)
    })

    it('rejects it when the channel itself closes', async () => {
      const { channel } = readied()

      const answer = channel.request({ op: EClientRequest.ReadEvents, params: {} })
      channel.close()

      await expect(answer).rejects.toBeInstanceOf(RemoteRequestLost)
    })
  })

  it('rejects a rewind in flight when the socket closes, since it may have applied', async () => {
    const { channel, drop } = readied()

    const answer = channel.request({ op: EClientRequest.Rewind, params: {} })
    drop()

    await expect(answer).rejects.toBeInstanceOf(RemoteRequestLost)
  })

  it('rejects a workspace publish in flight when the socket closes', async () => {
    const { channel, drop } = readied()

    const answer = channel.request({ op: EClientRequest.PublishWorkspace, params: {} })
    drop()

    await expect(answer).rejects.toBeInstanceOf(RemoteRequestLost)
  })

  describe('a restore or identity request in flight when the socket closes', () => {
    it('re-drives the restore on the next ready with the same id and op', async () => {
      const { channel, drop, retries, receive, live } = readied()

      const answer = channel.request({ op: EClientRequest.RestoreTranscript, params: {} })
      const first = upstreamOf(live().sent).find((frame) => frame.kind === EClientFrame.Request)
      drop()

      retries[0]?.run()
      live().handlers.handleOpen()
      receive({ kind: EServeFrame.Ready, seq: 9 })

      const resent = upstreamOf(live().sent).filter((frame) => frame.kind === EClientFrame.Request)
      expect(resent).toHaveLength(1)
      expect(resent[0]).toMatchObject({ op: EClientRequest.RestoreTranscript, params: {} })
      const id = resent[0]?.kind === EClientFrame.Request ? resent[0].id : ''
      expect(id).toBe(first?.kind === EClientFrame.Request ? first.id : '')

      receive({ kind: EServeFrame.Reply, replyTo: id, ok: true, data: { restored: true } })
      expect(await answer).toEqual({ restored: true })
    })

    it('re-drives the transcript-identity read on the next ready with the same id and op', async () => {
      const { channel, drop, retries, receive, live } = readied()

      const answer = channel.request({
        op: EClientRequest.ReadTranscriptIdentity,
        params: { threadId: 'brn_cloud', upTo: 0 },
      })
      const first = upstreamOf(live().sent).find((frame) => frame.kind === EClientFrame.Request)
      drop()

      retries[0]?.run()
      live().handlers.handleOpen()
      receive({ kind: EServeFrame.Ready, seq: 9 })

      const resent = upstreamOf(live().sent).filter((frame) => frame.kind === EClientFrame.Request)
      expect(resent).toHaveLength(1)
      expect(resent[0]).toMatchObject({
        op: EClientRequest.ReadTranscriptIdentity,
        params: { threadId: 'brn_cloud', upTo: 0 },
      })
      const id = resent[0]?.kind === EClientFrame.Request ? resent[0].id : ''
      expect(id).toBe(first?.kind === EClientFrame.Request ? first.id : '')

      receive({ kind: EServeFrame.Reply, replyTo: id, ok: true, data: { count: 0, digest: 'd' } })
      expect(await answer).toEqual({ count: 0, digest: 'd' })
    })
  })

  it('rejects every request in flight when the channel closes', async () => {
    const { channel } = readied()

    const answer = channel.request({ op: EClientRequest.CompletePaths, params: {} })
    channel.close()

    await expect(answer).rejects.toBeInstanceOf(RemoteRequestLost)
  })

  it('does not resend a request the reconnect already rejected', async () => {
    const { channel, drop, retries, receive, live } = harness()

    const answer = channel.request({ op: EClientRequest.Rewind, params: {} })
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

describe('a request against a parked channel', () => {
  it('fails a waiting request the moment the serve parks, rather than at its timeout', async () => {
    const { channel, receive } = readied({ requestTimeoutMs: 60_000 })

    const answer = channel.request({ op: EClientRequest.ReadEvents, params: {} })
    const failure = async (): Promise<unknown> => await answer.catch((error: unknown) => error)

    receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })

    const settled = await failure()
    expect(settled).toBeInstanceOf(RemoteRequestLost)
    expect((settled as RemoteRequestLost).message).toContain('the sandbox is parked')
    expect((settled as RemoteRequestLost).message).toContain('idle past the ttl')
  })

  it('rejects a new request while the sandbox is parked instead of stalling it', async () => {
    const { channel, receive, live } = readied({ requestTimeoutMs: 60_000 })
    receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })

    const failure = await channel
      .request({ op: EClientRequest.ReadEvents, params: {} })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(RemoteRequestLost)
    expect((failure as RemoteRequestLost).message).toContain('the sandbox is parked')
    expect(upstreamOf(live().sent).filter((frame) => frame.kind === EClientFrame.Request)).toEqual([])
  })

  it('keeps a request issued while the sandbox wakes and answers it on the fresh socket', async () => {
    const { channel, receive, live } = readied({ requestTimeoutMs: 60_000 })
    receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })

    channel.wake({ url: 'https://sandbox.test/woken', token: 'tok_woken' })
    const answer = channel.request({ op: EClientRequest.ReadEvents, params: {} })

    live().handlers.handleOpen()
    receive({ kind: EServeFrame.Ready, seq: 2 })

    const flushed = upstreamOf(live().sent).filter((frame) => frame.kind === EClientFrame.Request)
    expect(flushed).toHaveLength(1)
    const id = flushed[0]?.kind === EClientFrame.Request ? flushed[0].id : ''
    expect(id.length).toBeGreaterThan(0)

    receive({ kind: EServeFrame.Reply, replyTo: id, ok: true, data: { events: [] } })

    expect(await answer).toEqual({ events: [] })
  })
})
