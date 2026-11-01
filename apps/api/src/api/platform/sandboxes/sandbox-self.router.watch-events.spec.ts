import { EEventsWatchFrame, type EventsWatchFrame } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createTRPCClient, httpSubscriptionLink } from '@trpc/client'
import { EventSource } from 'eventsource'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { seedSandboxRow, seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { waitFor } from '../../../../test/fake-timers'
import type { AppRouter } from '../../../../../../packages/api-router/src/generated/server'
import {
  as,
  createSandboxSelfApp,
  routerSignals,
  SANDBOX_TOKEN,
} from './sandbox-self.router.fixture'

type StreamFailure = { data?: { httpStatus?: number } | null | undefined }

const wireEvent = (seq: number) => ({
  id: `ev-${seq}`,
  threadId: 'thr-1',
  seq,
  runId: 'run_web',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: 'user-said',
  body: '{}',
})

describe('SandboxSelfRouter watchEvents', () => {
  useTestDatabase()
  let app: NestExpressApplication
  let url: string
  const unsubscribers: Array<() => void> = []

  const watch = ({ threadId, token }: { threadId: string; token: string }) => {
    const frames: EventsWatchFrame[] = []
    const failures: StreamFailure[] = []
    const client = createTRPCClient<AppRouter>({
      links: [
        httpSubscriptionLink({
          url,
          EventSource,
          eventSourceOptions: () => ({
            fetch: (target, init) =>
              fetch(target, { ...init, headers: { ...init?.headers, ...as(token) } }),
          }),
        }),
      ],
    })
    const subscription = client.sandboxSelf.watchEvents.subscribe(
      { threadId },
      { onData: (frame) => frames.push(frame), onError: (failure) => failures.push(failure) },
    )
    unsubscribers.push(() => subscription.unsubscribe())
    return { frames, failures }
  }

  beforeAll(async () => {
    app = await createSandboxSelfApp()
    await app.listen(0)
    url = `${await app.getUrl()}/v1/trpc`
  })

  afterEach(() => {
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await seedUsers('usr-1')
    await seedSandboxRow({ threadId: 'thr-1', userId: 'usr-1', name: 'atlas-thread-1' })
  })

  it('ticks on connect, then again each time events are appended', async () => {
    const { frames } = watch({ threadId: 'thr-1', token: SANDBOX_TOKEN })
    await waitFor(() => expect(frames).toHaveLength(1))
    expect(frames[0]).toEqual({ type: EEventsWatchFrame.Tick })

    await routerSignals.signals.eventsAppended({
      threadId: 'thr-1',
      events: [wireEvent(1)],
      head: 1,
      historyRev: 0,
    })

    await waitFor(() => expect(frames.length).toBeGreaterThan(1))
    expect(frames.every((frame) => frame.type === EEventsWatchFrame.Tick)).toBe(true)
  })

  it('does not tick for another thread in the same family', async () => {
    await seedThreadRow({ id: 'thr-child', userId: 'usr-1', spawnerThreadId: 'thr-1' })
    const { frames } = watch({ threadId: 'thr-child', token: SANDBOX_TOKEN })
    await waitFor(() => expect(frames).toHaveLength(1))

    await routerSignals.signals.eventsAppended({
      threadId: 'thr-1',
      events: [wireEvent(1)],
      head: 1,
      historyRev: 0,
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(frames).toHaveLength(1)
  })

  it('refuses a thread outside the sandbox family', async () => {
    await seedThreadRow({ id: 'thr-other', userId: 'usr-1' })
    const { frames, failures } = watch({ threadId: 'thr-other', token: SANDBOX_TOKEN })

    await waitFor(() => expect(failures.length).toBeGreaterThan(0))
    expect(failures[0]?.data?.httpStatus).toBe(403)
    expect(frames).toEqual([])
  })
})
