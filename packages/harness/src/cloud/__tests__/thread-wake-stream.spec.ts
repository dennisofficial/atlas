import { afterEach, describe, expect, it } from 'bun:test'

import { watchThreadWakes } from '../thread-wake-stream'
import { dataFrame, opened, startServer, waitFor, type TestServer } from './sse-test-server'

describe('watchThreadWakes', () => {
  let server: TestServer | null = null
  afterEach(() => {
    server?.stop()
    server = null
  })

  it('hands each wake frame’s thread id to onWake over the user’s session', async () => {
    server = startServer({
      responses: [
        {
          status: 200,
          openEnded: true,
          body: opened(dataFrame({ type: 'wake', threadId: 'thr-1' })),
        },
      ],
    })
    const woken: string[] = []
    const controller = new AbortController()

    const running = watchThreadWakes({
      session: { url: server.url, token: 'tok-1', email: null },
      clientVersion: 'v-test',
      signal: controller.signal,
      onWake: ({ threadId }) => woken.push(threadId),
    })
    await waitFor(() => woken.length > 0)
    controller.abort()
    await running

    expect(woken).toEqual(['thr-1'])
    expect(server.requests[0]?.path).toBe('/v1/trpc/githubPrs.wakes')
    expect(server.requests[0]?.authorization).toBe('Bearer tok-1')
  })

  it('reconnects after the stream drops', async () => {
    server = startServer({
      responses: [
        { status: 503, body: '' },
        {
          status: 200,
          openEnded: true,
          body: opened(dataFrame({ type: 'wake', threadId: 'thr-2' })),
        },
      ],
    })
    const woken: string[] = []
    const controller = new AbortController()

    const running = watchThreadWakes({
      session: { url: server.url, token: 'tok-1', email: null },
      clientVersion: 'v-test',
      signal: controller.signal,
      onWake: ({ threadId }) => woken.push(threadId),
      retryFloorMs: 1,
    })
    await waitFor(() => woken.length > 0)
    controller.abort()
    await running

    expect(woken).toEqual(['thr-2'])
  })
})
