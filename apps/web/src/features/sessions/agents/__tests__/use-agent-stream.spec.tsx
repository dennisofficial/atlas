import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

import { createStreamConnection, ESessionConnection } from '@dltech/atlas-client/stream'
import {
  createFakeScheduler,
  createFakeTransport,
  eventsMessage,
  mintEvents,
  settle,
} from '@dltech/atlas-client/stream-fixture'
import { SESSION_VIEW_VERSION } from '@dltech/atlas-core'
import { EStreamCacheOutcome, STREAM_PROTOCOL_VERSION } from '@dltech/atlas-protocol'

const clock = createFakeScheduler()
const fakes = createFakeTransport()
const connection = createStreamConnection({
  transport: fakes.transport,
  scheduler: clock.scheduler,
})

const realStream = await import('@/features/sessions/data/session-stream')

mock.module('@/features/sessions/data/session-stream', () => ({
  sessionStream: () => connection,
  sessionLog: realStream.sessionLog,
}))

const { useAgentStream } = await import('../use-agent-stream')

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  mock.module('@/features/sessions/data/session-stream', () => realStream)
  await unregisterDom()
})

const mount = async (params: { sessionId: string; agentId: string }) => {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  function Probe() {
    const { snapshot } = useAgentStream({ sessionId: params.sessionId, agentId: params.agentId })
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
  return { host, root }
}

describe('useAgentStream', () => {
  it('follows the sub-agent thread of the session', async () => {
    const { host, root } = await mount({ sessionId: 'session-1', agentId: 'agent-1' })

    const subscription = fakes.follows[0]
    if (subscription === undefined) throw new Error('no subscription')
    expect(subscription.input).toEqual({
      sessionId: 'session-1',
      threadId: 'agent-1',
      tailViewVersion: SESSION_VIEW_VERSION,
      cache: EStreamCacheOutcome.Empty,
      hydrateMs: 0,
    })

    const events = mintEvents({ bodies: [{ type: 'user-said', text: 'working' }] })
    await act(async () => {
      subscription.handlers.handleFrame({
        type: 'ready',
        v: STREAM_PROTOCOL_VERSION,
        connectionId: 'c1',
      })
      subscription.handlers.handleFrame(eventsMessage({ id: 's1', events, live: true }))
      await settle()
    })
    expect(host.textContent).toBe(`${ESessionConnection.Live}|working`)

    await act(async () => root.unmount())
    expect(subscription.closed).toBe(true)
  })
})
