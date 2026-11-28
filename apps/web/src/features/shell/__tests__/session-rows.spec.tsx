import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { ThreadRow } from '../shell-thread-row'
import { partitionThreads, projectNameOf, type ShellSessionNode } from '../thread-partition'
import { ThreadActionsContext } from '../thread-actions-context'
import type { SessionSummary } from '@dltech/atlas-protocol'
import { rowOf, sessionHref, mergeSessions } from '../session-rows'
import { agoIso, projectOf, sessionOf, threadOf } from './fixtures'

const summary = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  sessionId: 'ses-a',
  projectId: 'p1',
  title: 'Fix login',
  naming: false,
  mainThreadId: 'thr-a',
  model: { ref: 'anthropic/claude-opus-5-5', effort: 'high', fast: false },
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

describe('rowOf', () => {
  it('carries the naming flag onto the row', () => {
    expect(rowOf(summary({ title: null, naming: true })).naming).toBe(true)
    expect(rowOf(summary()).naming).toBe(false)
  })

  it('maps a summary onto a row keyed by the session id', () => {
    const row = rowOf(summary())
    expect(row.id).toBe('ses-a')
    expect(row.mainThread).toMatchObject({
      id: 'ses-a',
      title: 'Fix login',
      updatedAt: agoIso(2),
      projectId: 'p1',
    })
    expect(row.teammates).toEqual([])
  })

  it('carries the archive stamp so the row lands in the Archived bucket', () => {
    const stamp = agoIso(1)
    const row = rowOf(summary({ archivedAt: stamp }))
    expect(row.mainThread.archivedAt).toBe(stamp)
    const merged = mergeSessions({
      entries: entries(),
      sessions: [summary({ archivedAt: stamp })],
    })
    const partition = partitionThreads({ entries: merged })
    expect(partition.archived[0]?.sessions.map((s) => s.id)).toEqual(['ses-a'])
    expect(rowOf(summary()).mainThread.archivedAt).toBeNull()
  })

  it('leaves the title unset when the session has none', () => {
    expect(rowOf(summary({ title: null })).mainThread.title).toBeUndefined()
  })
})

describe('mergeSessions', () => {
  it('adds each session to its project group and leaves others alone', () => {
    const base = entries()
    const merged = mergeSessions({
      entries: base,
      sessions: [summary(), summary({ sessionId: 'ses-b', projectId: 'p2' })],
    })
    expect(merged[0]?.sessions.map((s) => s.id)).toEqual([`ses_v1-old`, 'ses-a'])
    expect(merged[1]?.sessions.map((s) => s.id)).toEqual(['ses-b'])
    expect(merged[2]).toBe(base[2])
  })

  it('ignores sessions of unknown projects and returns the same entries when empty', () => {
    const base = entries()
    expect(mergeSessions({ entries: base, sessions: [] })).toBe(base)
    const merged = mergeSessions({
      entries: base,
      sessions: [summary({ projectId: 'gone' })],
    })
    expect(merged.map((e) => e.sessions.length)).toEqual([1, 0, 0])
  })

  it('files a session with no project under the no-project group', () => {
    const base = entries()
    const merged = mergeSessions({
      entries: base,
      sessions: [summary({ sessionId: 'loose', projectId: null })],
    })
    expect(merged[0]?.sessions.map((s) => s.id)).toEqual(['ses_v1-old'])
    expect(merged[1]?.sessions).toEqual([])
    expect(merged[2]?.sessions.map((s) => s.id)).toEqual(['loose'])
    const partition = partitionThreads({ entries: merged })
    expect(partition.groups.map((entry) => projectNameOf(entry.project))).toEqual([
      'project-p1',
      'No project',
    ])
    expect(partition.groups[1]?.sessions.map((s) => s.id)).toEqual(['loose'])
  })

  it('nests a projectless peer under its projectless creator', () => {
    const loose = (sessionId: string, overrides: Partial<SessionSummary> = {}) =>
      summary({ sessionId, projectId: null, ...overrides })
    const merged = mergeSessions({
      entries: entries(),
      sessions: [
        loose('loose-root', { createdAt: agoIso(9) }),
        loose('loose-peer', { createdAt: agoIso(8), spawnedBy: 'loose-root' }),
      ],
    })
    const rows = merged[2]?.sessions ?? []
    expect(rows.map((row) => row.id)).toEqual(['loose-root'])
    expect(rows[0]?.teammates.map((peer) => peer.id)).toEqual(['loose-peer'])
  })

  it('keeps an old v2 session in its project group', () => {
    const merged = mergeSessions({
      entries: entries(),
      sessions: [summary({ updatedAt: agoIso(100), createdAt: agoIso(101) })],
    })
    const partition = partitionThreads({ entries: merged })
    expect(partition.groups[0]?.sessions.map((s) => s.id)).toEqual(['ses-a', 'ses_v1-old'])
  })
})

const rowsOf = (sessions: readonly SessionSummary[]) =>
  mergeSessions({ entries: entries(), sessions })[0]?.sessions ?? []

const findRow = (
  sessions: readonly ShellSessionNode[],
  id: string,
): ShellSessionNode | undefined => {
  for (const session of sessions) {
    if (session.id === id) return session
    const found = findRow(session.teammates, id)
    if (found !== undefined) return found
  }
  return undefined
}

const childIdsOf = (sessions: readonly ShellSessionNode[], id: string): string[] =>
  findRow(sessions, id)?.teammates.map((peer) => peer.id) ?? []

describe('mergeSessions placement', () => {
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

  it('nests a spawned session under the session that created it', () => {
    const rows = rowsOf([root, peer])
    expect(rows.map((row) => row.id)).toEqual(['ses_v1-old', 'root'])
    expect(childIdsOf(rows, 'root')).toEqual(['peer'])
    expect(findRow(rows, 'peer')?.spawnedBy).toBe('root')
  })

  it('nests a grandchild under the child that created it', () => {
    const rows = rowsOf([root, peer, grandchild])
    expect(rows.map((row) => row.id)).toEqual(['ses_v1-old', 'root'])
    expect(childIdsOf(rows, 'root')).toEqual(['peer'])
    expect(childIdsOf(rows, 'peer')).toEqual(['grand'])
  })

  it('keeps a flat spawned session at the top level with its provenance', () => {
    const flat = summary({
      sessionId: 'flat',
      createdAt: agoIso(8),
      spawnedBy: 'root',
      nested: false,
    })
    const rows = rowsOf([root, flat])
    expect(rows.map((row) => row.id)).toEqual(['ses_v1-old', 'root', 'flat'])
    expect(childIdsOf(rows, 'root')).toEqual([])
    expect(findRow(rows, 'flat')?.spawnedBy).toBe('root')
  })

  it('keeps the children of an archived creator at the top level', () => {
    const archivedRoot = summary({
      sessionId: 'root',
      createdAt: agoIso(9),
      archivedAt: agoIso(1),
    })
    const rows = rowsOf([peer, archivedRoot])
    expect(rows.map((row) => row.id)).toEqual(['ses_v1-old', 'root', 'peer'])
    expect(childIdsOf(rows, 'root')).toEqual([])
    const html = render(findRow(rows, 'peer') as ShellSessionNode)
    expect(html).toContain('href="/sessions/peer"')
  })

  it('draws the indent instead of a provenance label', () => {
    const rows = rowsOf([root, peer])
    const html = render(rows.find((row) => row.id === 'root') as ShellSessionNode)
    expect(html).toContain('href="/sessions/peer"')
    expect(html).not.toContain('Created from')
    expect(html).not.toContain('created here')
  })

  it('orders roots by creation time and siblings under their creator', () => {
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
    expect(rows.map((row) => row.id)).toEqual(['ses_v1-old', 'root', 'newer'])
    expect(childIdsOf(rows, 'root')).toEqual(['early', 'late'])
    expect(rowsOf([early, late, root, newerRoot]).map((row) => row.id)).toEqual(
      rows.map((r) => r.id),
    )
  })
})

describe('mergeSessions rows', () => {
  it('gives every sidebar row a session view', () => {
    const merged = mergeSessions({
      entries: [{ project: projectOf('p1'), sessions: [] }],
      sessions: [summary()],
    })
    const rows = merged.flatMap((entry) => entry.sessions)
    expect(rows.length).toBe(1)
    expect(rows[0]?.view).toBeDefined()
  })
})

describe('v2 links', () => {
  it('links a session to /sessions/<id>', () => {
    expect(sessionHref('a b')).toBe('/sessions/a%20b')
  })
})

const render = (session: ReturnType<typeof rowOf>, activeId: string | null = null) =>
  renderToStaticMarkup(
    <SidebarProvider>
      <ThreadActionsContext.Provider value={{ onToggleArchive: () => undefined }}>
        <ThreadRow session={session} projectName="atlas" activeThreadId={activeId} />
      </ThreadActionsContext.Provider>
    </SidebarProvider>,
  )

describe('ThreadRow for a v2 session', () => {
  it('links to the session and offers archive and unarchive, without an engine tag', () => {
    const html = render(rowOf(summary()))
    expect(html).toContain('href="/sessions/ses-a"')
    expect(html).not.toContain('data-engine-tag')
    expect(html).toContain('Fix login')
    expect(html).toContain('Archive thread')
    expect(html).not.toContain('Pinned')
    const archived = render(rowOf(summary({ archivedAt: agoIso(1) })))
    expect(archived).toContain('Unarchive thread')
  })

  it('marks the row current when it is the active session', () => {
    expect(render(rowOf(summary()), 'ses-a')).toContain('aria-current="page"')
  })
})
