import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import {
  createStreamConnection,
  ESessionConnection,
  memorySessionCache,
} from '@dltech/atlas-client/stream'
import {
  createFakeScheduler,
  createFakeSockets,
  eventsMessage,
  mintEvents,
  settle,
} from '@dltech/atlas-client/stream-fixture'
import { STREAM_PROTOCOL_VERSION } from '@dltech/atlas-protocol'

import { useSessionStream } from '../use-session-stream'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const setup = () => {
  const clock = createFakeScheduler()
  const fakes = createFakeSockets()
  const connection = createStreamConnection({
    url: 'wss://stream.test/stream',
    getToken: () => Promise.resolve('token-1'),
    socket: fakes.factory,
    scheduler: clock.scheduler,
  })
  return { connection, sockets: fakes.sockets }
}

const mount = async (params: {
  connection: ReturnType<typeof setup>['connection']
  sessionId: string
}) => {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  const cache = memorySessionCache()
  const connection = () => params.connection
  function Probe() {
    const snapshot = useSessionStream({
      sessionId: params.sessionId,
      connection,
      cache,
    })
    const said = snapshot.events.flatMap((event) =>
      event.type === 'user-said' ? [event.text] : [],
    )
    return (
      <p>
        {snapshot.connection}|{said.join(',')}
      </p>
    )
  }
  await act(async () => root.render(<Probe />))
  return { host, root }
}

describe('useSessionStream', () => {
  it('subscribes on mount, renders events and unsubscribes on unmount', async () => {
    const { connection, sockets } = setup()
    const { host, root } = await mount({ connection, sessionId: 'session-1' })

    const socket = sockets[0]
    if (socket === undefined) throw new Error('no socket')
    await act(async () => {
      socket.open()
      await settle()
      socket.receive({ type: 'ready', v: STREAM_PROTOCOL_VERSION, connectionId: 'c1' })
      await settle()
    })
    const subscribe = socket.sent.find((message) => message.type === 'subscribe')
    expect(subscribe).toMatchObject({ sessionId: 'session-1' })
    const id = subscribe?.type === 'subscribe' ? subscribe.id : ''

    const events = mintEvents({ bodies: [{ type: 'user-said', text: 'hello' }] })
    await act(async () => {
      socket.receive(eventsMessage({ id, events, live: true }))
      await settle()
    })
    expect(host.textContent).toBe(`${ESessionConnection.Live}|hello`)

    await act(async () => root.unmount())
    expect(socket.sent[socket.sent.length - 1]).toEqual({ type: 'unsubscribe', id })
  })

  it('follows the new session when the id changes', async () => {
    const { connection, sockets } = setup()
    const first = await mount({ connection, sessionId: 'session-1' })
    const socket = sockets[0]
    if (socket === undefined) throw new Error('no socket')
    await act(async () => {
      socket.open()
      await settle()
      socket.receive({ type: 'ready', v: STREAM_PROTOCOL_VERSION, connectionId: 'c1' })
      await settle()
    })
    await act(async () => first.root.unmount())
    const second = await mount({ connection, sessionId: 'session-2' })
    await act(async () => settle())

    const subscribed = socket.sent.flatMap((message) =>
      message.type === 'subscribe' ? [message.sessionId] : [],
    )
    expect(subscribed).toEqual(['session-1', 'session-2'])
    expect(sockets).toHaveLength(1)
    await act(async () => second.root.unmount())
  })
})
