import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { notifyManager } from '@tanstack/react-query'
import { afterAll, afterEach, beforeAll, expect, it, spyOn } from 'bun:test'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import * as localFeed from '@/features/desktop/local-thread-feed'
import { localSummary } from '@/features/desktop/__tests__/local-thread-fixture'
import { localThreadBackend } from '@/features/desktop/local-thread-backend'
import { localThreadOf } from '@/features/desktop/local-thread'
import { threadOf } from '@/features/shell/__tests__/fixtures'
import {
  ELocalActivityState,
  listLocalThreads,
  type LocalThread,
} from '@/features/desktop/local-thread-wire'
import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

import { ThreadHeader } from '../../thread-header'
import { headerStateOf } from '../header-model'
import { activityUnavailableReason, type ThreadDisplay } from '../thread-display'
import { ThreadBackendProvider } from '../use-thread-backend'
import { cloudThreadBackend } from '../thread-backend'
import { useThreadMetadata } from '../use-thread-metadata'

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
  Reflect.deleteProperty(document, 'visibilityState')
})

function Header() {
  const thread = useThreadMetadata('brn_1')
  const reason = activityUnavailableReason(thread.data)
  return (
    <ThreadHeader
      title={thread.data?.title ?? null}
      state={headerStateOf({
        failed: false,
        working: false,
        waitingOnOperator: false,
        activityUnavailable: reason !== undefined,
      })}
      activityReason={reason}
      onOpenPanel={() => undefined}
    />
  )
}

it('refreshes the actual header for availability and reason-only changes on a quiet titled local thread', async () => {
  Reflect.set(window, 'atlasDesktop', {})
  let summary: LocalThread = localSummary
  const calls: { path: string; method: string }[] = []
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ path: String(input), method: init?.method ?? 'GET' })
      return Response.json({ threads: [summary] })
    },
    { preconnect: realFetch.preconnect },
  )
  let tick: (() => void) | undefined
  let onPolled: (() => void) | undefined
  const feed = localFeed.createLocalThreadFeed({
    schedule: ({ run }) => {
      tick = run
      onPolled?.()
      return () => {
        tick = undefined
      }
    },
  })
  const subscribe = spyOn(localFeed, 'subscribeLocalThreadMetadata').mockImplementation(
    feed.subscribeMetadata,
  )
  const notify = spyOn(toast, 'error').mockImplementation(() => 'unexpected-toast')
  const client = createTestQueryClient()
  const container = document.createElement('div')
  root = createRoot(container)
  const poll = async () => {
    const completed = new Promise<void>((resolve) => {
      onPolled = resolve
    })
    await act(async () => {
      tick?.()
      await completed
    })
  }
  const stopList = feed.subscribeChanges(() => undefined)
  try {
    await act(async () =>
      root?.render(
        <TestQueryProvider client={client}>
          <ThreadBackendProvider backend={localThreadBackend}>
            <SidebarProvider>
              <Header />
            </SidebarProvider>
          </ThreadBackendProvider>
        </TestQueryProvider>,
      ),
    )
    const badge = () => container.querySelector('[data-slot="badge"]')
    expect(badge()?.textContent).toBe('Idle')
    const { status, ...base } = localSummary
    summary = {
      ...base,
      activityState: ELocalActivityState.Unavailable,
      reason: 'Activity unsupported',
    }
    await poll()
    expect(badge()?.textContent).toBe('Activity unavailable')
    expect(badge()?.getAttribute('title')).toBe('Activity unavailable: Activity unsupported')
    summary = { ...summary, reason: 'Activity read timed out' }
    await poll()
    expect(badge()?.getAttribute('aria-label')).toBe(
      'Activity unavailable: Activity read timed out',
    )
    expect(
      client.getQueryData<{ value: ThreadDisplay }>(['thread:brn_1'])?.value.localAvailability,
    ).toMatchObject({
      activityState: 'unavailable',
      reason: 'Activity read timed out',
    })
    summary = localSummary
    await poll()
    expect(badge()?.textContent).toBe('Idle')
    expect(badge()?.hasAttribute('title')).toBe(false)
    expect(container.querySelector('h1')?.textContent).toBe('Host title')
    expect(calls.every((call) => call.path === '/desktop/threads' && call.method === 'GET')).toBe(
      true,
    )
    expect(notify).not.toHaveBeenCalled()
  } finally {
    await act(async () => root?.unmount())
    root = undefined
    stopList()
    subscribe.mockRestore()
    notify.mockRestore()
    client.clear()
  }
})

it('does not subscribe local metadata or poke Cloud queries for a Cloud thread on a native host', async () => {
  Reflect.set(window, 'atlasDesktop', {})
  const subscribe = spyOn(localFeed, 'subscribeLocalThreadMetadata')
  const fetch = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected request'))
  const client = createTestQueryClient()
  let reads = 0
  const backend = {
    ...cloudThreadBackend,
    fetchThread: async () => {
      reads += 1
      return threadOf({ id: 'cloud' })
    },
  }
  function Probe() {
    useThreadMetadata('cloud')
    return null
  }
  root = createRoot(document.createElement('div'))
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
    expect(reads).toBe(1)
    expect(subscribe).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    await act(async () => root?.unmount())
    root = undefined
    subscribe.mockRestore()
    fetch.mockRestore()
    client.clear()
  }
})

it('ignores an in-flight local metadata reading after hiding and refreshes on visibility recovery', async () => {
  Reflect.set(window, 'atlasDesktop', {})
  const { status, ...base } = localSummary
  const summary = {
    ...base,
    activityState: ELocalActivityState.Unavailable,
    reason: 'Activity unsupported',
  }
  let release: () => void = () => undefined
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  globalThis.fetch = Object.assign(
    async () => {
      await blocked
      return Response.json({ threads: [summary] })
    },
    { preconnect: realFetch.preconnect },
  )
  const feed = localFeed.createLocalThreadFeed({ schedule: () => () => undefined })
  const subscribe = spyOn(localFeed, 'subscribeLocalThreadMetadata').mockImplementation(
    feed.subscribeMetadata,
  )
  const client = createTestQueryClient()
  client.setQueryData(['thread:brn_1'], { value: localThreadOf(localSummary) })
  const container = document.createElement('div')
  root = createRoot(container)
  const setVisible = (value: 'hidden' | 'visible') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value })
    document.dispatchEvent(new Event('visibilitychange'))
  }
  try {
    await act(async () =>
      root?.render(
        <TestQueryProvider client={client}>
          <ThreadBackendProvider backend={localThreadBackend}>
            <SidebarProvider>
              <Header />
            </SidebarProvider>
          </ThreadBackendProvider>
        </TestQueryProvider>,
      ),
    )
    const pending = listLocalThreads()
    await act(async () => setVisible('hidden'))
    await act(async () => {
      release()
      await pending
    })
    expect(container.querySelector('[data-slot="badge"]')?.textContent).toBe('Idle')
    await act(async () => setVisible('visible'))
    expect(container.querySelector('[data-slot="badge"]')?.textContent).toBe('Activity unavailable')
  } finally {
    release()
    await act(async () => root?.unmount())
    root = undefined
    subscribe.mockRestore()
    client.clear()
  }
})
