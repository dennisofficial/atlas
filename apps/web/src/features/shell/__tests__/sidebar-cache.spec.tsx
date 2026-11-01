import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { QueryClient } from '@tanstack/react-query'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

import { EThreadLiveFrame, type ThreadLiveFrame } from '@dltech/atlas-wire/web'

import { resetDesktopCapabilities } from '@/features/desktop/desktop-wire'

import type { LiveListHandlers } from '../live-stream'
import { readSidebarCache, SIDEBAR_CACHE_KEY, writeSidebarCache } from '../sidebar-cache'
import type { ProjectThreads } from '../thread-partition'
import { agoIso, projectOf, sessionOf, threadOf } from './fixtures'

const threadsApi = await import('@/features/threads/data/threads-api')
let handlers: LiveListHandlers | undefined
mock.module('@/features/threads/data/threads-api', () => ({
  ...threadsApi,
  subscribeThreadsLive: (next: LiveListHandlers) => {
    handlers = next
    return { unsubscribe: () => undefined }
  },
}))

const { TestQueryProvider, createTestQueryClient } = await import(
  '@/lib/__tests__/query-test-provider'
)
const { SHELL_THREADS_KEY } = await import('@/lib/cloud-keys')
const { useLiveList } = await import('../use-live-list')

const roots: Root[] = []
const realFetch = globalThis.fetch

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

beforeEach(() => {
  window.localStorage.clear()
  handlers = undefined
  resetDesktopCapabilities()
  globalThis.fetch = (() => Promise.reject(new Error('not a desktop host'))) as typeof fetch
})

afterEach(async () => {
  globalThis.fetch = realFetch
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
})

const entriesWith = (title: string): ProjectThreads[] => [
  { project: projectOf('p1'), sessions: [sessionOf(threadOf({ id: title, title }))] },
]

function Probe() {
  const query = useLiveList()
  return <p>{query.data === undefined ? query.state : visibleTitles(query.data).join(',')}</p>
}

const titlesOf = (entry: ProjectThreads) =>
  entry.sessions.map((session) => session.mainThread.title).join('+')

const visibleTitles = (entries: ProjectThreads[]) =>
  entries.filter((entry) => entry.sessions.length > 0).map(titlesOf)

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

const snapshotOf = (title: string): ThreadLiveFrame => ({
  type: EThreadLiveFrame.Snapshot,
  rows: [
    {
      sessionId: `ses_${title}`,
      projectId: 'p1',
      managedBySessionId: null,
      sortAt: agoIso(1),
      rev: 1,
      thread: threadOf({ id: title, title, projectId: 'p1' }),
    },
  ],
  projects: [projectOf('p1')],
})

async function land(title: string) {
  await act(async () => {
    handlers?.onData(snapshotOf(title))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('sidebar cache module', () => {
  it('round-trips entries through the versioned payload', () => {
    writeSidebarCache(entriesWith('a'))
    expect(JSON.parse(window.localStorage.getItem(SIDEBAR_CACHE_KEY) ?? 'null').v).toBe(1)
    expect(readSidebarCache()?.map(titlesOf)).toEqual(['a'])
  })

  it('treats absent, corrupt, wrong-version and wrong-shape payloads as absent', () => {
    expect(readSidebarCache()).toBeUndefined()
    for (const raw of [
      '{not json',
      'null',
      '{"v":2,"entries":[]}',
      '{"v":1,"entries":"x"}',
      '{"v":1,"entries":[{"project":null}]}',
    ]) {
      window.localStorage.setItem(SIDEBAR_CACHE_KEY, raw)
      expect(readSidebarCache()).toBeUndefined()
    }
  })
})

describe('useLiveList sidebar cache', () => {
  it('stays loading when nothing is cached', async () => {
    const { container } = await mount()
    expect(container.textContent).toBe('loading')
  })

  it('renders cached entries before any snapshot, then the snapshot overwrites them', async () => {
    writeSidebarCache(entriesWith('cached'))
    const { container } = await mount()
    expect(container.textContent).toBe('cached')
    await land('fresh')
    expect(container.textContent).toBe('fresh')
  })

  it('writes the cache when a fresh snapshot publishes', async () => {
    await mount()
    await land('fresh')
    expect(visibleTitles(readSidebarCache() ?? [])).toEqual(['fresh'])
  })

  it('ignores corrupt cached JSON without throwing', async () => {
    window.localStorage.setItem(SIDEBAR_CACHE_KEY, '{broken')
    const { container } = await mount()
    expect(container.textContent).toBe('loading')
  })

  it('does not replace data already held by the query client', async () => {
    const client = createTestQueryClient()
    client.setQueryData([SHELL_THREADS_KEY], {
      value: { entries: entriesWith('live'), startedAt: 5 },
    })
    writeSidebarCache(entriesWith('cached'))
    const { container } = await mount(client)
    expect(container.textContent).toBe('live')
  })

  it('renders no cache on the server', () => {
    writeSidebarCache(entriesWith('cached'))
    const html = renderToString(
      <TestQueryProvider client={createTestQueryClient()}>
        <Probe />
      </TestQueryProvider>,
    )
    expect(html).toContain('loading')
    expect(html).not.toContain('cached')
  })
})
