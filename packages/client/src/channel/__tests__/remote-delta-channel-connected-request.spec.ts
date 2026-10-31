import { describe, expect, it } from 'bun:test'

import { EClientFrame, EClientRequest, EServeFrame } from '../channel-wire'
import { EConnectionView } from '../connection-view'
import {
  RemoteRequestFailed,
  RemoteRequestLost,
  type RemoteDeltaChannel,
} from '../remote-delta-channel'
import { harness, readied, THREAD } from './remote-channel-fixture'

const requestIfConnectedOf = (channel: RemoteDeltaChannel) => {
  const request = channel.requestIfConnected
  if (request === undefined) throw new Error('connected-only requests are not implemented')
  return request
}

const rename = {
  op: EClientRequest.RenameThread,
  params: { threadId: THREAD, title: 'Local title' },
}

describe('connected-only requests', () => {
  it('writes the existing RenameThread payload immediately and resolves its reply', async () => {
    const test = readied()

    const answer = requestIfConnectedOf(test.channel)(rename)
    expect(answer).toBeInstanceOf(Promise)
    expect(test.live().sent.filter((frame) => frame.kind === EClientFrame.Request)).toEqual([
      {
        kind: EClientFrame.Request,
        id: 'req-1',
        op: EClientRequest.RenameThread,
        params: { threadId: THREAD, title: 'Local title' },
      },
    ])

    test.receive({ kind: EServeFrame.Reply, replyTo: 'req-1', ok: true, data: { renamed: true } })
    expect(await answer).toEqual({ renamed: true })
  })

  it('does not wake, dial or queue while disconnected', () => {
    let wakes = 0
    const test = readied({
      maxAttempts: 0,
      wakeSandbox: () => {
        wakes += 1
        return new Promise(() => undefined)
      },
    })
    test.drop()
    expect(test.channel.connection().state).toBe(EConnectionView.Disconnected)
    const sentBefore = [...test.live().sent]

    expect(requestIfConnectedOf(test.channel)(rename)).toBeUndefined()
    expect(wakes).toBe(0)
    expect(test.sockets).toHaveLength(1)
    expect(test.live().sent).toEqual(sentBefore)
    expect(test.timeouts).toEqual([])

    test.channel.wake({ url: 'https://sandbox.test/', token: 'tok_session' })
    test.open()
    test.receive({ kind: EServeFrame.Ready, seq: 2 })
    expect(test.live().sent.filter((frame) => frame.kind === EClientFrame.Request)).toEqual([])
  })

  it('does not queue while dialing, waiting for Ready or reconnecting', () => {
    const test = harness()
    const request = requestIfConnectedOf(test.channel)
    expect(request(rename)).toBeUndefined()
    expect(test.live().sent).toEqual([])
    test.open()
    expect(request(rename)).toBeUndefined()
    test.receive({ kind: EServeFrame.Ready, seq: 1 })
    test.drop()
    expect(request(rename)).toBeUndefined()
    test.retries[0]?.run()
    test.open()
    test.receive({ kind: EServeFrame.Ready, seq: 2 })
    expect(
      test.sockets
        .flatMap((socket) => socket.sent)
        .filter((frame) => frame.kind === EClientFrame.Request),
    ).toEqual([])
    expect(test.timeouts).toEqual([])
  })

  it('leaves an already-parked socket untouched', () => {
    let wakes = 0
    const test = readied({
      wakeSandbox: () => {
        wakes += 1
        return new Promise(() => undefined)
      },
    })
    test.receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })
    const sentBefore = [...test.live().sent]

    expect(requestIfConnectedOf(test.channel)(rename)).toBeUndefined()
    expect(wakes).toBe(0)
    expect(test.live().sent).toEqual(sentBefore)
    expect(test.sockets).toHaveLength(1)
    expect(test.timeouts).toEqual([])
  })

  it('rejects on disconnect and never replays even ordinarily redrivable reads', async () => {
    for (const op of [EClientRequest.RenameThread, EClientRequest.ReadThread]) {
      const test = readied()
      const answer = requestIfConnectedOf(test.channel)({ op, params: rename.params })
      expect(answer).toBeInstanceOf(Promise)
      test.drop()
      await expect(answer).rejects.toBeInstanceOf(RemoteRequestLost)

      test.retries[0]?.run()
      test.open()
      test.receive({ kind: EServeFrame.Ready, seq: 2 })
      expect(test.live().sent.filter((frame) => frame.kind === EClientFrame.Request)).toEqual([])
    }
  })

  it('returns undefined on immediate socket write failure without queueing or leaving a deadline', () => {
    const test = readied()
    test.live().closed = true
    expect(test.channel.connection().state).toBe(EConnectionView.Connected)

    expect(requestIfConnectedOf(test.channel)(rename)).toBeUndefined()
    expect(test.live().sent.filter((frame) => frame.kind === EClientFrame.Request)).toEqual([])
    expect(test.timeouts).toEqual([])

    test.drop()
    test.retries[0]?.run()
    test.open()
    test.receive({ kind: EServeFrame.Ready, seq: 2 })
    expect(test.live().sent.filter((frame) => frame.kind === EClientFrame.Request)).toEqual([])
    test.channel.close()
  })

  it('keeps the reply deadline and sandbox rejection behavior', async () => {
    const test = readied({ requestTimeoutMs: 2_500 })
    const request = requestIfConnectedOf(test.channel)
    const expired = request(rename)
    expect(test.timeouts.map((timeout) => timeout.delayMs)).toEqual([2_500])
    test.timeouts[0]?.run()
    await expect(expired).rejects.toBeInstanceOf(RemoteRequestLost)

    const refused = request(rename)
    test.receive({ kind: EServeFrame.Reply, replyTo: 'req-2', ok: false, data: 'not found' })
    await expect(refused).rejects.toBeInstanceOf(RemoteRequestFailed)
  })

  it('does not send after the channel closes', () => {
    const test = readied()
    test.channel.close()
    const sentBefore = [...test.live().sent]

    expect(requestIfConnectedOf(test.channel)(rename)).toBeUndefined()
    expect(test.live().sent).toEqual(sentBefore)
    expect(test.timeouts).toEqual([])
  })

  it('leaves an unattached parked pod asleep without opening a socket or queuing a request', () => {
    let wakes = 0
    const test = harness({
      unattached: true,
      wakeSandbox: () => {
        wakes += 1
        return new Promise(() => undefined)
      },
    })

    expect(requestIfConnectedOf(test.channel)(rename)).toBeUndefined()
    expect(wakes).toBe(0)
    expect(test.sockets).toEqual([])
    expect(test.timeouts).toEqual([])

    test.channel.wake({ url: 'https://sandbox.test/', token: 'tok_session' })
    test.open()
    test.receive({ kind: EServeFrame.Ready, seq: 1 })
    expect(test.live().sent.filter((frame) => frame.kind === EClientFrame.Request)).toEqual([])
  })
})
