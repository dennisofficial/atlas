import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import type { WireThread } from '@dltech/atlas-wire/web'

import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'
import { type CloudQuery, useCloudQuery } from '@/lib/use-cloud-query'

import { createThreadSignalHub, type ThreadSignalListener } from '../thread-signal-hub'
import { useThreadMetadata } from '../use-thread-metadata'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const threadOf = (args: { id?: string; title?: string }): WireThread => ({
  id: args.id ?? 'thr_1',
  title: args.title ?? 'initial',
  head: 0,
  createdAt: '2026-10-31T00:00:00.000Z',
  updatedAt: '2026-10-31T00:00:00.000Z',
  workspace: null,
  repo: null,
})
const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 10)))

async function mount(args?: { load?: (id: string) => Promise<WireThread> }) {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  const client = createTestQueryClient()
  const hub = createThreadSignalHub()
  const listeners: ThreadSignalListener[] = []
  const signals = {
    ...hub,
    listen: (listener: ThreadSignalListener) => {
      listeners.push(listener)
      return hub.listen(listener)
    },
  }
  const reads: string[] = []
  let latest: CloudQuery<WireThread> | undefined
  function Probe({ threadId }: { threadId: string }) {
    latest = useCloudQuery({
      key: `thread:${threadId}`,
      load: () => {
        reads.push(threadId)
        return args?.load?.(threadId) ?? Promise.resolve(threadOf({ id: threadId }))
      },
    })
    useThreadMetadata({ threadId, signals })
    return null
  }
  const render = async (threadId: string) => {
    await act(async () =>
      root.render(
        <TestQueryProvider client={client}>
          <Probe threadId={threadId} />
        </TestQueryProvider>,
      ),
    )
    await flush()
  }
  await render('thr_1')
  return {
    hub,
    client,
    reads,
    listeners,
    render,
    latest: () => latest,
    unmount: () => act(async () => root.unmount()),
  }
}

describe('useThreadMetadata', () => {
  it('writes the exact boxed cache entry and keeps useCloudQuery ready', async () => {
    const test = await mount()
    try {
      const thread = threadOf({ title: 'streamed' })
      await act(async () => test.hub.emitMeta({ thread, rev: 1 }))
      await flush()
      expect(test.client.getQueryData(['thread:thr_1'])).toEqual({ value: thread })
      expect(test.client.getQueryData(['thread:thr_1:other'])).toBeUndefined()
      expect(test.latest()?.data).toEqual(thread)
      expect(test.reads).toEqual(['thr_1'])
    } finally {
      await test.unmount()
    }
  })

  it('rejects foreign, duplicate and stale frames and holds rev across reconnect', async () => {
    const test = await mount()
    try {
      const thread = threadOf({ title: 'newest' })
      await act(async () => {
        test.hub.emitMeta({ thread: threadOf({ title: 'older' }), rev: 1 })
        test.hub.emitMeta({ thread, rev: 3 })
      })
      await act(async () => {
        test.hub.emitStarted()
        test.hub.emitMeta({ thread: threadOf({ id: 'foreign' }), rev: 100 })
        test.hub.emitMeta({ thread: threadOf({ title: 'duplicate' }), rev: 3 })
        test.hub.emitMeta({ thread: threadOf({ title: 'stale' }), rev: 2 })
      })
      expect(test.client.getQueryData(['thread:thr_1'])).toEqual({ value: thread })
    } finally {
      await test.unmount()
    }
  })

  it('keeps initial and manual GETs but never reloads for Started pokes', async () => {
    const test = await mount()
    try {
      await act(async () => {
        test.hub.emitStarted()
      })
      expect(test.reads).toEqual(['thr_1'])
      await act(async () => test.latest()?.reload())
      await flush()
      expect(test.reads).toEqual(['thr_1', 'thr_1'])
    } finally {
      await test.unmount()
    }
  })

  it('cancels a pending initial GET so its late answer cannot overwrite metadata', async () => {
    let release: (thread: WireThread) => void = () => undefined
    const test = await mount({
      load: () =>
        new Promise((resolve) => {
          release = resolve
        }),
    })
    try {
      const thread = threadOf({ title: 'live' })
      expect(test.client.isFetching({ queryKey: ['thread:thr_1'], exact: true })).toBe(1)
      await act(async () => test.hub.emitMeta({ thread, rev: 1 }))
      expect(test.client.isFetching({ queryKey: ['thread:thr_1'], exact: true })).toBe(0)
      await act(async () => release(threadOf({ title: 'old GET' })))
      await flush()
      expect(test.latest()?.data).toEqual(thread)
      expect(test.client.getQueryData(['thread:thr_1'])).toEqual({ value: thread })
    } finally {
      await test.unmount()
    }
  })

  it('cancels a pending manual GET without changing the initial fetching path', async () => {
    let release: (thread: WireThread) => void = () => undefined
    let initial = true
    const test = await mount({
      load: () => {
        if (initial) {
          initial = false
          return Promise.resolve(threadOf({}))
        }
        return new Promise((resolve) => {
          release = resolve
        })
      },
    })
    try {
      await act(async () => test.latest()?.reload())
      expect(test.reads).toEqual(['thr_1', 'thr_1'])
      const thread = threadOf({ title: 'live during reload' })
      await act(async () => test.hub.emitMeta({ thread, rev: 2 }))
      await act(async () => release(threadOf({ title: 'stale reload' })))
      await flush()
      expect(test.latest()?.data).toEqual(thread)
      expect(test.client.isFetching({ queryKey: ['thread:thr_1'], exact: true })).toBe(0)
    } finally {
      await test.unmount()
    }
  })

  it('ignores stopped callbacks and pending writes, resets rev only on thread switch', async () => {
    const test = await mount()
    await act(async () => test.hub.emitMeta({ thread: threadOf({}), rev: 10 }))
    const stopped = test.listeners[0]
    await test.render('thr_2')
    const other = threadOf({ id: 'thr_2', title: 'other' })
    await act(async () => {
      stopped?.onMeta?.({ thread: threadOf({ title: 'stopped' }), rev: 100 })
      test.hub.emitMeta({ thread: other, rev: 0 })
    })
    expect(test.client.getQueryData(['thread:thr_2'])).toEqual({ value: other })
    expect(test.client.getQueryData(['thread:thr_1'])).toEqual({ value: threadOf({}) })
    const before = test.client.getQueryData(['thread:thr_2'])
    await act(async () => {
      test.hub.emitMeta({ thread: threadOf({ id: 'thr_2', title: 'pending' }), rev: 1 })
      await test.unmount()
    })
    await test.listeners.at(-1)?.onMeta?.({ thread: other, rev: 200 })
    expect(test.client.getQueryData(['thread:thr_2'])).toEqual(before)
  })
})
