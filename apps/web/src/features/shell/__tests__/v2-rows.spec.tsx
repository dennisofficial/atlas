import { afterEach, describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { fakeFetch, mutationUrl, trpcOk } from '@/features/threads/data/__tests__/trpc-fake'

import { archiveThread } from '../archive-thread'
import { searchHrefOf, searchItemsOf } from '../search-items'
import { ThreadRow } from '../shell-thread-row'
import { partitionThreads, type ShellSessionNode } from '../thread-partition'
import { ThreadActionsContext } from '../thread-actions-context'
import {
  v2RowOf,
  v2SessionHref,
  v2SessionIdsOf,
  withV2Sessions,
  type V2SessionSummary,
} from '../v2-rows'
import { agoIso, NOW, projectOf, sessionOf, threadOf } from './fixtures'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const summary = (overrides: Partial<V2SessionSummary> = {}): V2SessionSummary => ({
  sessionId: 'v2-a',
  projectId: 'p1',
  title: 'Fix login',
  naming: false,
  mainThreadId: 'thr-a',
  createdAt: agoIso(5),
  updatedAt: agoIso(2),
  archivedAt: null,
  ...overrides,
})

const entries = () => [
  {
    project: projectOf('p1'),
    sessions: [sessionOf(threadOf({ id: 'v1-old', updatedAt: agoIso(10) }))],
  },
  { project: projectOf('p2'), sessions: [] },
  { project: null, sessions: [] },
]

describe('v2RowOf', () => {
  it('carries the naming flag onto the row', () => {
    expect(v2RowOf(summary({ title: null, naming: true })).naming).toBe(true)
    expect(v2RowOf(summary()).naming).toBe(false)
  })

  it('maps a summary onto a tagged row keyed by the session id', () => {
    const row = v2RowOf(summary())
    expect(row.v2).toBe(true)
    expect(row.id).toBe('v2-a')
    expect(row.mainThread).toMatchObject({
      id: 'v2-a',
      title: 'Fix login',
      updatedAt: agoIso(2),
      projectId: 'p1',
    })
    expect(row.teammates).toEqual([])
  })

  it('carries the archive stamp so the row lands in the Archived bucket', () => {
    const stamp = agoIso(1)
    const row = v2RowOf(summary({ archivedAt: stamp }))
    expect(row.mainThread.archivedAt).toBe(stamp)
    const merged = withV2Sessions({
      entries: entries(),
      sessions: [summary({ archivedAt: stamp })],
    })
    const partition = partitionThreads({ entries: merged, now: NOW })
    expect(partition.archived[0]?.sessions.map((s) => s.id)).toEqual(['v2-a'])
    expect(v2RowOf(summary()).mainThread.archivedAt).toBeNull()
  })

  it('collects the ids of v2 rows only', () => {
    const merged = withV2Sessions({
      entries: entries(),
      sessions: [summary()],
    })
    expect([...v2SessionIdsOf(merged)]).toEqual(['v2-a'])
    expect(v2SessionIdsOf(undefined).size).toBe(0)
  })

  it('leaves the title unset when the session has none', () => {
    expect(v2RowOf(summary({ title: null })).mainThread.title).toBeUndefined()
  })
})

describe('withV2Sessions', () => {
  it('adds each session to its project group and leaves others alone', () => {
    const base = entries()
    const merged = withV2Sessions({
      entries: base,
      sessions: [summary(), summary({ sessionId: 'v2-b', projectId: 'p2' })],
    })
    expect(merged[0]?.sessions.map((s) => s.id)).toEqual([`ses_v1-old`, 'v2-a'])
    expect(merged[1]?.sessions.map((s) => s.id)).toEqual(['v2-b'])
    expect(merged[2]).toBe(base[2])
  })

  it('ignores sessions of unknown projects and returns the same entries when empty', () => {
    const base = entries()
    expect(withV2Sessions({ entries: base, sessions: [] })).toBe(base)
    const merged = withV2Sessions({
      entries: base,
      sessions: [summary({ projectId: 'gone' })],
    })
    expect(merged.map((e) => e.sessions.length)).toEqual([1, 0, 0])
  })

  it('orders v2 sessions with v1 threads and buckets them by recency', () => {
    const merged = withV2Sessions({
      entries: entries(),
      sessions: [summary({ updatedAt: agoIso(100), createdAt: agoIso(101) })],
    })
    const partition = partitionThreads({ entries: merged, now: NOW })
    expect(partition.groups[0]?.sessions.map((s) => s.id)).toEqual(['ses_v1-old'])
    expect(partition.inactive[0]?.sessions.map((s) => s.id)).toEqual(['v2-a'])
  })
})

const rowsOf = (sessions: readonly V2SessionSummary[]) =>
  withV2Sessions({ entries: entries(), sessions })[0]?.sessions ?? []

const childIdsOf = (sessions: readonly ShellSessionNode[], id: string): string[] =>
  sessions.find((session) => session.id === id)?.teammates.map((peer) => peer.id) ?? []

describe('withV2Sessions placement', () => {
  const root = summary({ sessionId: 'root', createdAt: agoIso(9) })
  const peer = summary({
    sessionId: 'peer',
    createdAt: agoIso(8),
    spawnedBy: 'root',
  })
  const grandchild = summary({
    sessionId: 'grand',
    createdAt: agoIso(7),
    spawnedBy: 'peer',
  })

  it('lists a spawned session as a row of its own, like one made from the new-session button', () => {
    const rows = rowsOf([root, peer])
    expect(rows.map((row) => row.id)).toEqual(['ses_v1-old', 'root', 'peer'])
    expect(childIdsOf(rows, 'root')).toEqual([])
    expect(rows.find((row) => row.id === 'peer')?.spawnedBy).toBe('root')
  })

  it('lists a grandchild as its own row too, keeping only its provenance', () => {
    const rows = rowsOf([root, peer, grandchild])
    expect(rows.map((row) => row.id)).toEqual(['ses_v1-old', 'root', 'peer', 'grand'])
    expect(rows.every((row) => row.teammates.length === 0)).toBe(true)
    expect(rows.find((row) => row.id === 'grand')?.spawnedBy).toBe('peer')
  })

  it('draws no provenance label, because a spawned session is not a child', () => {
    const rows = rowsOf([root, peer])
    const html = render(rows.find((row) => row.id === 'peer') as ShellSessionNode)
    expect(html).not.toContain('Created from')
    expect(rows.find((row) => row.id === 'peer')?.spawnedBy).toBe('root')
  })

  it('lists an archived spawned session as its own row', () => {
    const archived = summary({
      sessionId: 'peer',
      title: 'Done peer',
      createdAt: agoIso(8),
      archivedAt: agoIso(1),
      spawnedBy: 'root',
    })
    const rows = rowsOf([root, archived])
    expect(rows.map((row) => row.id)).toEqual(['ses_v1-old', 'root', 'peer'])
    expect(childIdsOf(rows, 'root')).toEqual([])
    const html = render(rows.find((row) => row.id === 'peer') as ShellSessionNode, 'peer')
    expect(html).toContain('href="/sessions/peer"')
  })

  it('keeps a peer whose spawner is not in the project as a root', () => {
    const rows = rowsOf([summary({ sessionId: 'orphan', spawnedBy: 'elsewhere' })])
    expect(rows.map((row) => row.id)).toEqual(['ses_v1-old', 'orphan'])
    expect(childIdsOf(rows, 'orphan')).toEqual([])
  })

  it('keeps a peer whose spawner lives in another project as a root', () => {
    const merged = withV2Sessions({
      entries: entries(),
      sessions: [summary({ sessionId: 'far', projectId: 'p2', spawnedBy: 'root' }), root],
    })
    expect(merged[0]?.sessions.map((row) => row.id)).toEqual(['ses_v1-old', 'root'])
    expect(merged[1]?.sessions.map((row) => row.id)).toEqual(['far'])
  })

  it('collects a nested peer and its children as v2 sessions', () => {
    const merged = withV2Sessions({
      entries: entries(),
      sessions: [root, peer, grandchild],
    })
    expect([...v2SessionIdsOf(merged)].sort()).toEqual(['grand', 'peer', 'root'])
  })

  it('archives a nested peer through the v2 sessions route', async () => {
    const merged = withV2Sessions({
      entries: entries(),
      sessions: [root, peer],
    })
    const calls = fakeFetch(() => trpcOk({ archivedAt: null }))
    await archiveThread({
      threadId: 'peer',
      archived: true,
      v2: v2SessionIdsOf(merged).has('peer'),
    })
    expect(calls).toEqual([
      {
        url: mutationUrl('sessions.archive'),
        method: 'POST',
        body: { sessionId: 'peer', archived: true },
      },
    ])
  })

  it('orders every session by creation time however the list arrives', () => {
    const early = summary({
      sessionId: 'early',
      createdAt: agoIso(8),
      spawnedBy: 'root',
    })
    const late = summary({
      sessionId: 'late',
      createdAt: agoIso(3),
      spawnedBy: 'root',
    })
    const newerRoot = summary({ sessionId: 'newer', createdAt: agoIso(4) })
    const rows = rowsOf([late, newerRoot, root, early])
    expect(rows.map((row) => row.id)).toEqual(['ses_v1-old', 'root', 'early', 'newer', 'late'])
    expect(childIdsOf(rows, 'root')).toEqual([])
    expect(rowsOf([early, late, root, newerRoot]).map((row) => row.id)).toEqual(
      rows.map((r) => r.id),
    )
  })
})

describe('v2 links', () => {
  it('links a session to /sessions/<id>', () => {
    expect(v2SessionHref('a b')).toBe('/sessions/a%20b')
  })

  it('routes v2 search results to the session page', () => {
    const { threads } = searchItemsOf(withV2Sessions({ entries: entries(), sessions: [summary()] }))
    const v2 = threads.find((t) => t.id === 'v2-a')
    const v1 = threads.find((t) => t.id === 'v1-old')
    expect(v2 && searchHrefOf(v2)).toBe('/sessions/v2-a')
    expect(v1 && searchHrefOf(v1)).toBe('/threads/v1-old')
  })
})

const render = (session: ReturnType<typeof v2RowOf>, activeId: string | null = null) =>
  renderToStaticMarkup(
    <SidebarProvider>
      <ThreadActionsContext.Provider value={{ onToggleArchive: () => undefined }}>
        <ThreadRow session={session} projectName="atlas" activeThreadId={activeId} />
      </ThreadActionsContext.Provider>
    </SidebarProvider>,
  )

describe('ThreadRow for a v2 session', () => {
  it('shows the v2 tag, links to the session and offers archive and unarchive', () => {
    const html = render(v2RowOf(summary()))
    expect(html).toContain('href="/sessions/v2-a"')
    expect(html).toContain('data-engine-tag="v2"')
    expect(html).toContain('Fix login')
    expect(html).toContain('Archive thread')
    expect(html).not.toContain('Pinned')
    const archived = render(v2RowOf(summary({ archivedAt: agoIso(1) })))
    expect(archived).toContain('Unarchive thread')
  })

  it('marks the row current when it is the active session', () => {
    expect(render(v2RowOf(summary()), 'v2-a')).toContain('aria-current="page"')
  })

  it('leaves v1 rows untagged', () => {
    const html = render(sessionOf(threadOf({ id: 'solo', title: 'Solo' })))
    expect(html).not.toContain('data-engine-tag')
    expect(html).toContain('href="/threads/solo"')
    expect(html).toContain('Archive thread')
  })
})
