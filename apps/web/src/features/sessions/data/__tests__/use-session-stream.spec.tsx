import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import {
  createStreamConnection,
  ESessionConnection,
  memorySessionLog,
} from '@dltech/atlas-client/stream'
import {
  createFakeScheduler,
  createFakeTransport,
  eventsMessage,
  mintEvents,
  settle,
} from '@dltech/atlas-client/stream-fixture'
import { STREAM_PROTOCOL_VERSION } from '@dltech/atlas-protocol'

import { useSessionStream } from '../use-session-stream'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

const setup = () => {
  const clock = createFakeScheduler()
  const fakes = createFakeTransport()
  const connection = createStreamConnection({
    transport: fakes.transport,
    scheduler: clock.scheduler,
  })
  return { connection, follows: fakes.follows }
}

const mount = async (params: {
  connection: ReturnType<typeof setup>['connection']
  sessionId: string
  threadId?: string
}) => {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  const log = memorySessionLog()
  const connection = () => params.connection
  const loaders: { loadOlder?: () => Promise<number> } = {}
  function Probe() {
    const { snapshot, loadOlder } = useSessionStream({
      sessionId: params.sessionId,
      threadId: params.threadId,
      connection,
      log,
    })
    loaders.loadOlder = loadOlder
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
  await settle()
  const loadOlder = (): Promise<number> => loaders.loadOlder?.() ?? Promise.resolve(-1)
  return { host, root, loadOlder }
}

describe('useSessionStream', () => {
  it('subscribes on mount, renders events and aborts on unmount', async () => {
    const { connection, follows } = setup()
    const { host, root, loadOlder } = await mount({ connection, sessionId: 'session-1' })

    expect(await loadOlder()).toBe(0)
    const subscription = follows[0]
    if (subscription === undefined) throw new Error('no subscription')
    expect(subscription.input).toEqual({ sessionId: 'session-1' })
    const events = mintEvents({ bodies: [{ type: 'user-said', text: 'hello' }] })
    await act(async () => {
      subscription.handlers.handleFrame({
        type: 'ready',
        v: STREAM_PROTOCOL_VERSION,
        connectionId: 'c1',
      })
      subscription.handlers.handleFrame(eventsMessage({ id: 's1', events, live: true }))
      await settle()
    })
    expect(host.textContent).toBe(`${ESessionConnection.Live}|hello`)
    expect(await loadOlder()).toBe(0)

    await act(async () => root.unmount())
    expect(subscription.closed).toBe(true)
  })

  it('follows the given thread when a thread id is set', async () => {
    const { connection, follows } = setup()
    const { root } = await mount({ connection, sessionId: 'session-1', threadId: 'agent-1' })

    const subscription = follows[0]
    if (subscription === undefined) throw new Error('no subscription')
    expect(subscription.input).toEqual({ sessionId: 'session-1', threadId: 'agent-1' })
    await act(async () => root.unmount())
  })

  it('follows the new session when the id changes', async () => {
    const { connection, follows } = setup()
    const first = await mount({ connection, sessionId: 'session-1' })
    await act(async () => first.root.unmount())
    const second = await mount({ connection, sessionId: 'session-2' })
    await act(async () => settle())

    expect(follows.map((entry) => entry.input?.sessionId)).toEqual(['session-1', 'session-2'])
    await act(async () => second.root.unmount())
  })
})
