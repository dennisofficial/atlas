import { EClientFrame, EServeFrame } from '@dltech/atlas-wire'
import { describe, expect, it } from 'bun:test'
import { deliverToServe, type ServeSocketHandlers } from './serve-send'

const DELIVERY = {
  url: 'https://serve.example.test/',
  token: 'tok',
  threadId: 'thr-1',
  sendId: 'snd-1',
  text: 'hi',
}

function fakeSocket() {
  const sent: string[] = []
  let handlers: ServeSocketHandlers | undefined
  let closed = 0
  let opened: { url: string; protocols: string[] } | undefined
  return {
    sent,
    closedCount: () => closed,
    opened: () => opened,
    open: (args: { url: string; protocols: string[]; handlers: ServeSocketHandlers }) => {
      handlers = args.handlers
      opened = { url: args.url, protocols: args.protocols }
      return { send: (data: string) => sent.push(data), close: () => (closed += 1) }
    },
    handlers: () => {
      if (handlers === undefined) throw new Error('socket not opened')
      return handlers
    },
  }
}

describe('deliverToServe', () => {
  it('sends hello then send and resolves on the matching ack', async () => {
    const socket = fakeSocket()
    const delivery = deliverToServe({ ...DELIVERY, openSocket: socket.open })

    socket.handlers().handleOpen()
    socket
      .handlers()
      .handleMessage(JSON.stringify({ kind: EServeFrame.SendAcked, sendId: 'other' }))
    socket
      .handlers()
      .handleMessage(JSON.stringify({ kind: EServeFrame.SendAcked, sendId: 'snd-1' }))
    await delivery

    expect(socket.opened()).toEqual({
      url: 'wss://serve.example.test/v1/session',
      protocols: ['atlas.v1', 'bearer.tok'],
    })
    expect(socket.sent.map((raw) => JSON.parse(raw))).toMatchObject([
      { kind: EClientFrame.Hello, threadId: 'thr-1', channelCursor: null, lastEventSeq: 0 },
      { kind: EClientFrame.Send, sendId: 'snd-1', text: 'hi' },
    ])
    expect(socket.closedCount()).toBe(1)
  })

  it('rejects on an error frame and closes', async () => {
    const socket = fakeSocket()
    const delivery = deliverToServe({ ...DELIVERY, openSocket: socket.open })

    socket
      .handlers()
      .handleMessage(JSON.stringify({ kind: EServeFrame.Error, message: 'protocol mismatch' }))

    await expect(delivery).rejects.toThrow('protocol mismatch')
    expect(socket.closedCount()).toBe(1)
  })

  it('rejects when the socket closes before the ack', async () => {
    const socket = fakeSocket()
    const delivery = deliverToServe({ ...DELIVERY, openSocket: socket.open })

    socket.handlers().handleEnd()

    await expect(delivery).rejects.toThrow('closed the connection')
  })

  it('rejects on timeout and closes', async () => {
    const socket = fakeSocket()

    await expect(
      deliverToServe({ ...DELIVERY, timeoutMs: 10, openSocket: socket.open }),
    ).rejects.toThrow('did not acknowledge')
    expect(socket.closedCount()).toBe(1)
  })
})
