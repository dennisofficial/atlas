import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import type { QueryClient } from '@tanstack/react-query'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

import { memorySessionLog } from '@dltech/atlas-client/stream'

import type { SessionSummary } from '@dltech/atlas-protocol'
import { readSessionsCache, SESSIONS_CACHE_KEY, writeSessionsCache } from '../sidebar-cache'
import { agoIso, projectOf } from './fixtures'

mock.module('@/features/projects/data/projects-api', () => ({
  fetchProjects: () => Promise.resolve([projectOf('p1')]),
}))

const sessionsApi = await import('@/features/sessions/data/sessions-api')

let pending: {
  resolve: (rows: SessionSummary[]) => void
  reject: (error: unknown) => void
}[] = []

mock.module('@/features/sessions/data/sessions-api', () => ({
  ...sessionsApi,
  fetchSessions: () =>
    new Promise<SessionSummary[]>((resolve, reject) => {
      pending.push({ resolve, reject })
    }),
}))

const followers = (() => {
  let rows: readonly SessionSummary[] | undefined
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
    emit: (next: readonly SessionSummary[]) => {
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
const { SESSIONS_KEY } = await import('@/lib/cloud-keys')
const { useSessions } = await import('../use-sessions')
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
})

afterEach(async () => {
  globalThis.fetch = realFetch
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
})

const summary = (sessionId: string, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
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
  const sessions = useSessions()
  return <p>{sessions.map((session) => session.sessionId).join(',') || 'empty'}</p>
}

function ShellProbe() {
  const query = useShellEntries()
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
  await act(async () => {
    root.render(
      <TestQueryProvider client={client}>
        <ShellProbe />
      </TestQueryProvider>,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
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

async function land(rows: SessionSummary[]) {
  await act(async () => {
    pending[0]?.resolve(rows)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('v2 sessions cache module', () => {
  it('round-trips sessions through the versioned payload', () => {
    writeSessionsCache([summary('ses-a')])
    expect(JSON.parse(window.localStorage.getItem(SESSIONS_CACHE_KEY) ?? 'null').v).toBe(1)
    expect(readSessionsCache()?.map((session) => session.sessionId)).toEqual(['ses-a'])
  })

  it('treats absent, corrupt, wrong-version and wrong-shape payloads as absent', () => {
    expect(readSessionsCache()).toBeUndefined()
    for (const raw of [
      '{not json',
      'null',
      '{"v":2,"sessions":[]}',
      '{"v":1,"sessions":"x"}',
      '{"v":1,"sessions":[{"createdAt":"2026-10-24T12:00:00.000Z"}]}',
    ]) {
      window.localStorage.setItem(SESSIONS_CACHE_KEY, raw)
      expect(readSessionsCache()).toBeUndefined()
    }
  })
})

describe('useSessions sidebar cache', () => {
  it('renders cached sessions before the first fetch resolves', async () => {
    writeSessionsCache([summary('ses-cached')])
    const { container } = await mount()
    expect(container.textContent).toBe('ses-cached')
    await land([summary('ses-live')])
    expect(container.textContent).toBe('ses-live')
  })

  it('fetches over the cached sessions and caches the result', async () => {
    writeSessionsCache([summary('ses-cached')])
    await mount()
    expect(pending).toHaveLength(1)
    await land([summary('ses-live')])
    expect(readSessionsCache()?.map((session) => session.sessionId)).toEqual(['ses-live'])
  })

  it('writes the cache when the sessions feed emits', async () => {
    await mount()
    await land([summary('ses-http')])
    await act(async () => {
      followers.emit([summary('ses-feed')])
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(readSessionsCache()?.map((session) => session.sessionId)).toEqual(['ses-feed'])
  })

  it('does not replace data already held by the query client', async () => {
    const client = createTestQueryClient()
    client.setQueryData([SESSIONS_KEY], [summary('ses-live')])
    writeSessionsCache([summary('ses-cached')])
    const { container } = await mount(client)
    expect(container.textContent).toBe('ses-live')
    expect(pending).toHaveLength(0)
  })

  it('ignores corrupt cached JSON without throwing', async () => {
    window.localStorage.setItem(SESSIONS_CACHE_KEY, '{broken')
    const { container } = await mount()
    expect(container.textContent).toBe('empty')
    expect(pending).toHaveLength(1)
  })

  it('renders no cache on the server', () => {
    writeSessionsCache([summary('ses-cached')])
    const html = renderToString(
      <TestQueryProvider client={createTestQueryClient()}>
        <Probe />
      </TestQueryProvider>,
    )
    expect(html).toContain('empty')
    expect(html).not.toContain('ses-cached')
  })
})

describe('useShellEntries', () => {
  it('builds sidebar rows from the projects query and the cached v2 sessions', async () => {
    writeSessionsCache([summary('ses-cached', { title: 'ses-cached' })])
    const client = createTestQueryClient()
    client.setQueryData(['projects'], { value: [projectOf('p1')] })
    const { container } = await mountShell(client)
    expect(container.textContent).toBe('ses-cached')
  })

  it('lists a project with no v2 sessions as an empty group', async () => {
    const client = createTestQueryClient()
    client.setQueryData(['projects'], { value: [projectOf('p1'), projectOf('p2')] })
    client.setQueryData([SESSIONS_KEY], [summary('ses-a', { title: 'ses-a' })])
    const { container } = await mountShell(client)
    expect(container.textContent).toBe('ses-a')
  })
})
