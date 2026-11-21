import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import type { QueryClient } from '@tanstack/react-query'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

import { memorySessionLog } from '@dltech/atlas-client/stream'

import { resetDesktopCapabilities } from '@/features/desktop/desktop-wire'

import type { LiveListHandlers } from '../live-stream'
import type { ProjectThreads } from '../thread-partition'
import type { V2SessionSummary } from '../v2-rows'
import {
  readV2SessionsCache,
  SIDEBAR_CACHE_KEY,
  V2_SESSIONS_CACHE_KEY,
  writeSidebarCache,
  writeV2SessionsCache,
} from '../sidebar-cache'
import { agoIso, projectOf, sessionOf, threadOf } from './fixtures'

const threadsApi = await import('@/features/threads/data/threads-api')

mock.module('@/features/threads/data/threads-api', () => ({
  ...threadsApi,
  subscribeThreadsLive: (_next: LiveListHandlers) => ({ unsubscribe: () => undefined }),
}))

const sessionsApi = await import('@/features/sessions/data/sessions-api')

let pending: {
  resolve: (rows: V2SessionSummary[]) => void
  reject: (error: unknown) => void
}[] = []

mock.module('@/features/sessions/data/sessions-api', () => ({
  ...sessionsApi,
  fetchV2Sessions: () =>
    new Promise<V2SessionSummary[]>((resolve, reject) => {
      pending.push({ resolve, reject })
    }),
}))

const followers = (() => {
  let rows: readonly V2SessionSummary[] | undefined
  const listeners = new Set<() => void>()
  return {
    list: {
      getSnapshot: () => rows,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      close: () => listeners.clear(),
    },
    emit: (next: readonly V2SessionSummary[]) => {
      rows = next
      for (const listener of [...listeners]) listener()
    },
    reset: () => {
      rows = undefined
      listeners.clear()
    },
  }
})()

mock.module('@/features/sessions/data/session-stream', () => ({
  sessionStream: () => ({ followSessions: () => followers.list }),
  sessionLog: () => memorySessionLog(),
}))

const { TestQueryProvider, createTestQueryClient } = await import(
  '@/lib/__tests__/query-test-provider'
)
const { V2_SESSIONS_KEY } = await import('@/lib/cloud-keys')
const { useV2Sessions } = await import('../use-v2-sessions')
const { useShellEntries } = await import('../use-shell-entries')

const roots: Root[] = []
const realFetch = globalThis.fetch

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

beforeEach(() => {
  window.localStorage.clear()
  followers.reset()
  pending = []
  resetDesktopCapabilities()
  globalThis.fetch = (() => Promise.reject(new Error('not a desktop host'))) as typeof fetch
})

afterEach(async () => {
  globalThis.fetch = realFetch
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
})

const summary = (
  sessionId: string,
  overrides: Partial<V2SessionSummary> = {},
): V2SessionSummary => ({
  sessionId,
  projectId: 'p1',
  title: `title-${sessionId}`,
  naming: false,
  mainThreadId: `thr-${sessionId}`,
  model: { ref: 'anthropic/claude-opus-5-5', effort: 'high', fast: false },
  createdAt: agoIso(5),
  updatedAt: agoIso(2),
  archivedAt: null,
  ...overrides,
})

function Probe() {
  const sessions = useV2Sessions()
  return <p>{sessions.map((session) => session.sessionId).join(',') || 'empty'}</p>
}

function ShellProbe() {
  const query = useShellEntries(null)
  return (
    <p>
      {query.data === undefined
        ? query.state
        : query.data.entries
            .flatMap((entry) => entry.sessions.map((session) => session.mainThread.title))
            .join(',')}
    </p>
  )
}

async function mountShell(client: QueryClient = createTestQueryClient()) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () =>
    root.render(
      <TestQueryProvider client={client}>
        <ShellProbe />
      </TestQueryProvider>,
    ),
  )
  return { container, client }
}

async function mount(client: QueryClient = createTestQueryClient()) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () =>
    root.render(
      <TestQueryProvider client={client}>
        <Probe />
      </TestQueryProvider>,
    ),
  )
  return { container, client }
}

async function land(rows: V2SessionSummary[]) {
  await act(async () => {
    pending[0]?.resolve(rows)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('v2 sessions cache module', () => {
  it('round-trips sessions through the versioned payload', () => {
    writeV2SessionsCache([summary('v2-a')])
    expect(JSON.parse(window.localStorage.getItem(V2_SESSIONS_CACHE_KEY) ?? 'null').v).toBe(1)
    expect(readV2SessionsCache()?.map((session) => session.sessionId)).toEqual(['v2-a'])
  })

  it('treats absent, corrupt, wrong-version and wrong-shape payloads as absent', () => {
    expect(readV2SessionsCache()).toBeUndefined()
    for (const raw of [
      '{not json',
      'null',
      '{"v":2,"sessions":[]}',
      '{"v":1,"sessions":"x"}',
      '{"v":1,"sessions":[{"createdAt":"2026-10-24T12:00:00.000Z"}]}',
    ]) {
      window.localStorage.setItem(V2_SESSIONS_CACHE_KEY, raw)
      expect(readV2SessionsCache()).toBeUndefined()
    }
  })
})

describe('useV2Sessions sidebar cache', () => {
  it('renders cached sessions before the first fetch resolves', async () => {
    writeV2SessionsCache([summary('v2-cached')])
    const { container } = await mount()
    expect(container.textContent).toBe('v2-cached')
    await land([summary('v2-live')])
    expect(container.textContent).toBe('v2-live')
  })

  it('fetches over the cached sessions and caches the result', async () => {
    writeV2SessionsCache([summary('v2-cached')])
    await mount()
    expect(pending).toHaveLength(1)
    await land([summary('v2-live')])
    expect(readV2SessionsCache()?.map((session) => session.sessionId)).toEqual(['v2-live'])
  })

  it('writes the cache when the sessions feed emits', async () => {
    await mount()
    await land([summary('v2-http')])
    await act(async () => {
      followers.emit([summary('v2-feed')])
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(readV2SessionsCache()?.map((session) => session.sessionId)).toEqual(['v2-feed'])
  })

  it('does not replace data already held by the query client', async () => {
    const client = createTestQueryClient()
    client.setQueryData([V2_SESSIONS_KEY], [summary('v2-live')])
    writeV2SessionsCache([summary('v2-cached')])
    const { container } = await mount(client)
    expect(container.textContent).toBe('v2-live')
    expect(pending).toHaveLength(0)
  })

  it('ignores corrupt cached JSON without throwing', async () => {
    window.localStorage.setItem(V2_SESSIONS_CACHE_KEY, '{broken')
    const { container } = await mount()
    expect(container.textContent).toBe('empty')
    expect(pending).toHaveLength(1)
  })

  it('renders no cache on the server', () => {
    writeV2SessionsCache([summary('v2-cached')])
    const html = renderToString(
      <TestQueryProvider client={createTestQueryClient()}>
        <Probe />
      </TestQueryProvider>,
    )
    expect(html).toContain('empty')
    expect(html).not.toContain('v2-cached')
  })
})

describe('useShellEntries with both sidebar caches', () => {
  const v1Entries = (title: string): ProjectThreads[] => [
    { project: projectOf('p1'), sessions: [sessionOf(threadOf({ id: title, title }))] },
  ]

  it('paints v1 rows and cached v2 sessions on the first frame', async () => {
    writeSidebarCache(v1Entries('v1-cached'))
    writeV2SessionsCache([summary('v2-cached', { title: 'v2-cached' })])
    const { container } = await mountShell()
    expect(container.textContent).toContain('v1-cached')
    expect(container.textContent).toContain('v2-cached')
  })

  it('stays loading when only the v2 cache is warm', async () => {
    expect(window.localStorage.getItem(SIDEBAR_CACHE_KEY)).toBeNull()
    writeV2SessionsCache([summary('v2-cached', { title: 'v2-cached' })])
    const { container } = await mountShell()
    expect(container.textContent).toBe('loading')
  })
})
