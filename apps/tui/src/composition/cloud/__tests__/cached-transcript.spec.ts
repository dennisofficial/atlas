import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toThreadId } from '@dltech/atlas-core'
import { SessionsClient } from '@dltech/atlas-harness'

import { fakeCloud, fakeSignedOutCloud } from '../../__tests__/fake-app'
import { readCachedCloudTranscript } from '../cached-transcript'

const THREAD = toThreadId('cached-transcript-thread')

const wireEvent = (seq: number) => ({
  id: `event-${seq}`,
  seq,
  threadId: THREAD,
  runId: 'run-1',
  depth: 0,
  at: '2026-10-02T00:00:00.000Z',
  body: JSON.stringify({ type: 'user-said', text: `line ${seq}` }),
})

const cloudReplying = (reply: () => Response) =>
  fakeCloud({
    sessionsClientFor: ({ session }) =>
      new SessionsClient({
        url: session.url,
        token: session.token,
        fetchFn: (async () => reply()) as unknown as typeof fetch,
      }),
  })

const read = (cloud: ReturnType<typeof fakeCloud>) =>
  readCachedCloudTranscript({
    app: {
      cloud,
      threads: { find: async () => undefined },
    } as never,
    threadId: THREAD,
    effects: () => undefined,
  })

describe('readCachedCloudTranscript', () => {
  it('opens the API events as a started cloud conversation bound to the thread', async () => {
    const opened = await read(
      cloudReplying(() => Response.json({ result: { data: [wireEvent(1), wireEvent(2)] } })),
    )

    expect(opened?.events.map((event) => event.seq)).toEqual([1, 2])
    expect(opened?.executionLocation).toBe(EExecutionLocation.Cloud)
    expect(opened?.bootCloudThreadId).toBe(THREAD)
    expect(opened?.started).toBe(true)
  })

  it('is null with no events, on a failed read, and when signed out', async () => {
    expect(await read(cloudReplying(() => Response.json({ result: { data: [] } })))).toBeNull()
    expect(await read(cloudReplying(() => new Response('boom', { status: 500 })))).toBeNull()
    expect(await read(fakeSignedOutCloud())).toBeNull()
  })
})
