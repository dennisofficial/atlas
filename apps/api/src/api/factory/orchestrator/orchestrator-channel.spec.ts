import { describe, expect, it, vi } from 'vitest'
import {
  CHANNEL_PROTOCOL_VERSION,
  createOrchestratorChannel,
  sessionSocketUrlOf,
  type ChannelSocket,
  type ChannelSocketFactory,
} from './orchestrator-channel'

type FakeHandlers = Parameters<ChannelSocketFactory>[0]

type FakeSocket = ChannelSocket & {
  handlers: FakeHandlers
  sent: string[]
  closed: boolean
}

const fakeFactory = (): { factory: ChannelSocketFactory; sockets: FakeSocket[] } => {
  const sockets: FakeSocket[] = []
  const factory: ChannelSocketFactory = (handlers) => {
    const socket: FakeSocket = {
      handlers,
      sent: [],
      closed: false,
      send(data) {
        this.sent.push(data)
      },
      close() {
        this.closed = true
      },
    }
    sockets.push(socket)
    return socket
  }
  return { factory, sockets }
}

const greet = (socket: FakeSocket): void => {
  socket.handlers.handleOpen()
  socket.handlers.handleMessage(JSON.stringify({ kind: 'ready', seq: 1, protocol: CHANNEL_PROTOCOL_VERSION }))
}

const INJECT = {
  url: 'https://factory-x-3000.vercel.run',
  token: 'tok_secret',
  threadId: 'brn_orchestrator_1',
  text: 'wake up',
}

const acceptedImmediately = () => vi.fn(async () => true)

describe('sessionSocketUrlOf', () => {
  it('maps the https route to the session websocket path', () => {
    expect(sessionSocketUrlOf('https://factory-x-3000.vercel.run')).toBe(
      'wss://factory-x-3000.vercel.run/v1/session',
    )
  })
})

describe('orchestrator channel', () => {
  it('offers the channel and bearer subprotocols', () => {
    const { factory, sockets } = fakeFactory()
    const channel = createOrchestratorChannel({ socketFactory: factory })
    void channel.inject({ ...INJECT, accepted: acceptedImmediately() }).catch(() => undefined)

    expect(sockets[0]?.handlers.url).toBe('wss://factory-x-3000.vercel.run/v1/session')
    expect(sockets[0]?.handlers.protocols).toEqual(['atlas.v1', 'bearer.tok_secret'])
  })

  it('says hello on open, injects once ready, and resolves when the message is accepted', async () => {
    const { factory, sockets } = fakeFactory()
    const channel = createOrchestratorChannel({ socketFactory: factory })
    const pending = channel.inject({ ...INJECT, accepted: acceptedImmediately() })

    const socket = sockets[0] as FakeSocket
    socket.handlers.handleOpen()
    const hello = JSON.parse(socket.sent[0] as string) as Record<string, unknown>
    expect(hello).toEqual({
      kind: 'hello',
      threadId: 'brn_orchestrator_1',
      channelCursor: null,
      lastEventSeq: 0,
      protocol: CHANNEL_PROTOCOL_VERSION,
    })

    socket.handlers.handleMessage(JSON.stringify({ kind: 'ready', seq: 1, protocol: CHANNEL_PROTOCOL_VERSION }))
    const sent = JSON.parse(socket.sent[1] as string) as Record<string, unknown>
    expect(sent).toEqual({ kind: 'send', text: 'wake up' })

    await pending
    expect(socket.closed).toBe(true)
  })

  it('keeps waiting while the acceptance probe has not seen the commit', async () => {
    const { factory, sockets } = fakeFactory()
    const channel = createOrchestratorChannel({ socketFactory: factory })
    const probe = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const pending = channel.inject({ ...INJECT, accepted: probe })

    const socket = sockets[0] as FakeSocket
    greet(socket)
    await pending
    expect(probe.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('does not mistake backfilled frames for acceptance', async () => {
    const { factory, sockets } = fakeFactory()
    const channel = createOrchestratorChannel({ socketFactory: factory })
    const pending = channel.inject({ ...INJECT, accepted: acceptedImmediately() })

    const socket = sockets[0] as FakeSocket
    socket.handlers.handleOpen()
    socket.handlers.handleMessage(JSON.stringify({ kind: 'signal', seq: 1, signal: {} }))
    socket.handlers.handleMessage(JSON.stringify({ kind: 'ready', seq: 2, protocol: CHANNEL_PROTOCOL_VERSION }))
    await pending

    const sent = JSON.parse(socket.sent[1] as string) as Record<string, unknown>
    expect(sent).toEqual({ kind: 'send', text: 'wake up' })
  })

  it('rejects when the serve refuses with an error frame', async () => {
    const { factory, sockets } = fakeFactory()
    const channel = createOrchestratorChannel({ socketFactory: factory })
    const pending = channel.inject({ ...INJECT, accepted: acceptedImmediately() })

    const socket = sockets[0] as FakeSocket
    greet(socket)
    socket.handlers.handleMessage(JSON.stringify({ kind: 'error', message: 'no credentials' }))
    await expect(pending).rejects.toThrow('no credentials')
  })

  it('rejects when the serve speaks another wire protocol', async () => {
    const { factory, sockets } = fakeFactory()
    const channel = createOrchestratorChannel({ socketFactory: factory })
    const pending = channel.inject({ ...INJECT, accepted: acceptedImmediately() })

    const socket = sockets[0] as FakeSocket
    socket.handlers.handleOpen()
    socket.handlers.handleMessage(JSON.stringify({ kind: 'ready', seq: 1, protocol: 3 }))
    await expect(pending).rejects.toThrow('wire protocol 3')
    expect(socket.sent).toHaveLength(1)
  })

  it('rejects when the socket closes before acceptance', async () => {
    const { factory, sockets } = fakeFactory()
    const channel = createOrchestratorChannel({ socketFactory: factory })
    const pending = channel.inject({ ...INJECT, accepted: acceptedImmediately() })

    const socket = sockets[0] as FakeSocket
    greet(socket)
    socket.handlers.handleClose(1006, 'abnormal')
    await expect(pending).rejects.toThrow('1006')
  })

  it('shrugs off a failing acceptance probe and keeps waiting', async () => {
    const { factory, sockets } = fakeFactory()
    const channel = createOrchestratorChannel({ socketFactory: factory })
    const probe = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('db blinked'))
      .mockResolvedValue(true)
    const pending = channel.inject({ ...INJECT, accepted: probe })

    const socket = sockets[0] as FakeSocket
    greet(socket)
    await pending
  })

  it('ignores frames that do not decode', async () => {
    const { factory, sockets } = fakeFactory()
    const channel = createOrchestratorChannel({ socketFactory: factory })
    const pending = channel.inject({ ...INJECT, accepted: acceptedImmediately() })

    const socket = sockets[0] as FakeSocket
    socket.handlers.handleOpen()
    socket.handlers.handleMessage('not json')
    socket.handlers.handleMessage(JSON.stringify({ kind: 'mystery' }))
    socket.handlers.handleMessage(JSON.stringify({ kind: 'ready', seq: 1, protocol: CHANNEL_PROTOCOL_VERSION }))
    await pending
  })
})
