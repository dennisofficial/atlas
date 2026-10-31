import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { notifyManager } from '@tanstack/react-query'
import { afterAll, afterEach, beforeAll, expect, it, spyOn } from 'bun:test'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { useThreadSignals } from '@/features/threads/data/use-thread-signals'
import { useThreadSource, type ThreadSource } from '@/features/threads/data/use-thread-source'
import { useThreadQuery } from '@/features/threads/data/use-thread-query'
import { ThreadBackendProvider } from '@/features/threads/data/use-thread-backend'
import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

import * as localFeed from '../local-thread-feed'
import { localThreadBackend } from '../local-thread-backend'
import { localEvent, localSummary } from './local-thread-fixture'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  notifyManager.setScheduler(queueMicrotask)
})
afterAll(async () => {
  notifyManager.setScheduler((callback) => setTimeout(callback, 0))
  await GlobalRegistrator.unregister()
})
const realFetch = globalThis.fetch
let root: ReturnType<typeof createRoot> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
})

enum EResourceReading {
  Unavailable = 'unavailable',
  Pending = 'pending',
}

for (const resource of Object.values(EResourceReading)) {
  it(`keeps local history and metadata flowing while resource status is ${resource}`, async () => {
    Reflect.set(window, 'atlasDesktop', {})
    let summary = { ...localSummary }
    let log = [localEvent(1), localEvent(3)]
    let release: () => void = () => undefined
    const pendingResource = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls: { path: string; method: string }[] = []
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const path = String(input)
        calls.push({ path, method: init?.method ?? 'GET' })
        if (path === '/desktop/threads') return Response.json({ threads: [summary] })
        if (path.includes('/events?')) {
          const after = Number(new URL(path, 'http://localhost').searchParams.get('after'))
          return Response.json({
            events: log.filter((event) => event.seq > after),
            head: summary.head,
            nextAfter: null,
          })
        }
        if (path.endsWith('/status')) {
          if (resource === EResourceReading.Pending) await pendingResource
          return Response.json({ message: 'Resources unavailable' }, { status: 503 })
        }
        if (path === '/desktop/pods/brn_1')
          return Response.json({
            threadId: 'brn_1',
            projectId: 'p1',
            createdAt: localSummary.createdAt,
            state: 'stopped',
          })
        throw new Error(`Unexpected request: ${path}`)
      },
      { preconnect: realFetch.preconnect },
    )
    let tick: (() => void) | undefined
    const feed = localFeed.createLocalThreadFeed({
      schedule: ({ run }) => {
        tick = run
        return () => {
          tick = undefined
        }
      },
    })
    const subscribe = spyOn(localFeed, 'subscribeLocalThreadMetadata').mockImplementation(
      feed.subscribeMetadata,
    )
    const failures: unknown[] = []
    let subscriptions = 0
    let wakes = 0
    const backend = {
      ...localThreadBackend,
      subscribeStream: (args: Parameters<typeof feed.subscribeStream>[0]) => {
        subscriptions += 1
        return feed.subscribeStream({
          ...args,
          handlers: {
            ...args.handlers,
            onError: (failure) => {
              failures.push(failure)
              args.handlers.onError(failure)
            },
          },
        })
      },
      wake: async () => {
        wakes += 1
        throw new Error('Unexpected wake')
      },
    }
    let source: ThreadSource | undefined
    let metadata: ReturnType<typeof useThreadQuery> | undefined
    function Probe() {
      metadata = useThreadQuery('brn_1')
      const signals = useThreadSignals('brn_1')
      source = useThreadSource({ threadId: 'brn_1', signals, liveEligible: false })
      return null
    }
    const client = createTestQueryClient()
    root = createRoot(document.createElement('div'))
    const poll = async () => {
      const run = tick
      expect(run).toBeFunction()
      tick = undefined
      await act(async () => run?.())
      expect(tick).toBeFunction()
    }
    try {
      await act(async () =>
        root?.render(
          <TestQueryProvider client={client}>
            <ThreadBackendProvider backend={backend}>
              <Probe />
            </ThreadBackendProvider>
          </TestQueryProvider>,
        ),
      )
      await poll()
      summary = {
        ...summary,
        title: 'First host edit',
        head: 5,
        lastAssistantSeq: 5,
        status: { ...summary.status, lastAssistantSeq: 5 },
      }
      log = [...log, localEvent(5)]
      await poll()
      expect(source?.events).toEqual(log)
      expect(metadata?.data).toMatchObject({ title: 'First host edit', head: 5 })
      summary = {
        ...summary,
        title: 'Second host edit',
        head: 6,
        lastAssistantSeq: 6,
        status: { ...summary.status, lastAssistantSeq: 6 },
      }
      log = [...log, localEvent(6)]
      await poll()
      expect(source?.events).toEqual(log)
      expect(source?.error).toBeNull()
      expect(metadata?.data).toMatchObject({ title: 'Second host edit', head: 6 })
      expect(failures).toEqual([])
      expect(subscriptions).toBe(1)
      expect(wakes).toBe(0)
      expect(
        calls.every((call) => call.method === 'GET' && call.path.startsWith('/desktop/')),
      ).toBe(true)
      if (resource === EResourceReading.Pending) {
        expect(calls.filter((call) => call.path.endsWith('/status'))).toHaveLength(1)
      } else {
        await expect(localThreadBackend.fetchPod('brn_1')).rejects.toThrow('Resources unavailable')
      }
    } finally {
      await act(async () => root?.unmount())
      root = undefined
      release()
      await pendingResource
      subscribe.mockRestore()
      client.clear()
    }
  })
}
