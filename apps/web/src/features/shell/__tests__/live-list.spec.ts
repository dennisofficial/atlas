import { describe, expect, it } from 'bun:test'

import {
  EThreadLiveFrame,
  type LiveThreadRow,
  type Project,
  type ThreadLiveFrame,
} from '@dltech/atlas-wire/web'

import { applyLiveFrame, emptyLiveList, entriesOf } from '../live-list'

import { NOW, agoIso, projectOf, threadOf } from './fixtures'

function rowOf({ id, ...overrides }: Partial<LiveThreadRow> & { id: string }): LiveThreadRow {
  return {
    sessionId: `ses_${id}`,
    projectId: null,
    managedBySessionId: null,
    sortAt: agoIso(1),
    rev: 1,
    thread: threadOf({ id, projectId: overrides.projectId ?? null }),
    ...overrides,
  }
}

const snapshotOf = ({
  rows = [],
  projects = [],
}: {
  rows?: LiveThreadRow[]
  projects?: Project[]
} = {}): ThreadLiveFrame => ({ type: EThreadLiveFrame.Snapshot, rows, projects })
const upsertOf = (row: LiveThreadRow): ThreadLiveFrame => ({ type: EThreadLiveFrame.Upsert, row })
const removeOf = (rev: number): ThreadLiveFrame => ({
  type: EThreadLiveFrame.Remove,
  sessionId: 'ses_t1',
  threadId: 't1',
  rev,
})
const projectUpsertOf = (project: Project): ThreadLiveFrame => ({
  type: EThreadLiveFrame.ProjectUpsert,
  project,
})
const projectRemoveOf = (projectId = 'p1'): ThreadLiveFrame => ({
  type: EThreadLiveFrame.ProjectRemove,
  projectId,
})
const stateOf = (...frames: ThreadLiveFrame[]) =>
  frames.reduce((state, frame) => applyLiveFrame({ state, frame }).state, emptyLiveList())

describe('applyLiveFrame rev ordering', () => {
  it('ignores stale and equal upserts without replacing the state', () => {
    const state = stateOf(upsertOf(rowOf({ id: 't1', rev: 5 })))
    for (const rev of [4, 5]) {
      expect(applyLiveFrame({ state, frame: upsertOf(rowOf({ id: 't1', rev })) }).state).toBe(state)
    }
  })

  it('accepts a newer upsert', () => {
    const state = stateOf(...[2, 3].map((rev) => upsertOf(rowOf({ id: 't1', rev }))))
    expect(state.rows.get('t1')?.rev).toBe(3)
  })

  it('ignores older removes but accepts equal and newer removes', () => {
    const state = stateOf(upsertOf(rowOf({ id: 't1', rev: 4 })))
    expect(applyLiveFrame({ state, frame: removeOf(3) }).state).toBe(state)
    for (const rev of [4, 5]) {
      const removed = applyLiveFrame({ state, frame: removeOf(rev) }).state
      expect(removed.rows.has('t1')).toBe(false)
      expect(removed.removedRevs.get('t1')).toBe(rev)
    }
    expect(state.rows.has('t1')).toBe(true)
  })

  it('retains a removed row high-water mark through older removes and stale or equal upserts', () => {
    const state = stateOf(upsertOf(rowOf({ id: 't1', rev: 4 })), removeOf(5), removeOf(3))
    for (const rev of [4, 5]) {
      expect(applyLiveFrame({ state, frame: upsertOf(rowOf({ id: 't1', rev })) }).state).toBe(state)
    }
    expect(state.rows.has('t1')).toBe(false)
    expect(state.removedRevs.get('t1')).toBe(5)
  })

  it('records absent-row removals, advances their high-water mark and permits newer upserts', () => {
    const state = stateOf(
      removeOf(5),
      removeOf(7),
      removeOf(6),
      upsertOf(rowOf({ id: 't1', rev: 7 })),
    )
    expect(state.rows.has('t1')).toBe(false)
    expect(state.removedRevs.get('t1')).toBe(7)
    const next = applyLiveFrame({ state, frame: upsertOf(rowOf({ id: 't1', rev: 8 })) }).state
    expect(next.rows.get('t1')?.rev).toBe(8)
    expect(next.removedRevs.get('t1')).toBe(7)
  })
})

describe('applyLiveFrame snapshot', () => {
  it('replaces rows and projects, clears tombstones and marks the list ready', () => {
    const project = projectOf('p1')
    const state = stateOf(
      upsertOf(rowOf({ id: 'old' })),
      removeOf(8),
      projectRemoveOf(),
      projectUpsertOf(projectOf('old')),
      snapshotOf({ rows: [rowOf({ id: 't1' })], projects: [project] }),
    )
    expect(state.ready).toBe(true)
    expect([...state.rows.keys()]).toEqual(['t1'])
    expect([...state.projects.keys()]).toEqual(['p1'])
    expect(state.removedRevs.size).toBe(0)
    expect(state.deletedProjectIds.size).toBe(0)
    const next = applyLiveFrame({
      state,
      frame: upsertOf(rowOf({ id: 't1', rev: 2, projectId: 'p1' })),
    }).state
    expect(next.rows.get('t1')?.projectId).toBe('p1')
    expect(
      applyLiveFrame({
        state,
        frame: projectUpsertOf({ ...project, updatedAt: agoIso(0) }),
      }).state.projects.get('p1')?.updatedAt,
    ).toBe(agoIso(0))
  })
})

describe('applyLiveFrame project frames', () => {
  it('upserts a project and moves its rows to projectless on removal', () => {
    const project = projectOf('p1')
    const state = stateOf(
      snapshotOf({ rows: [rowOf({ id: 't1', projectId: 'p1' })] }),
      projectUpsertOf(project),
    )
    expect(state.projects.get('p1')).toEqual(project)
    const removed = applyLiveFrame({ state, frame: projectRemoveOf() }).state
    expect(removed.projects.has('p1')).toBe(false)
    expect(removed.rows.get('t1')?.projectId).toBeNull()
    expect(removed.rows.get('t1')?.thread.projectId).toBeNull()
    expect(entriesOf(removed)[0]?.sessions[0]?.mainThread.id).toBe('t1')
    expect(state.rows.get('t1')?.thread.projectId).toBe('p1')
  })

  it('normalizes affected rows even when the project is unknown and preserves other rows', () => {
    const unaffected = rowOf({ id: 'other', projectId: 'p2' })
    const state = stateOf(
      snapshotOf({
        rows: [
          rowOf({ id: 't1', projectId: 'p1' }),
          rowOf({ id: 'thread-only', thread: threadOf({ id: 'thread-only', projectId: 'p1' }) }),
          unaffected,
        ],
      }),
      projectRemoveOf(),
    )
    for (const id of ['t1', 'thread-only']) {
      expect(state.rows.get(id)?.projectId).toBeNull()
      expect(state.rows.get(id)?.thread.projectId).toBeNull()
    }
    expect(state.rows.get('other')).toBe(unaffected)
    expect(state.deletedProjectIds.has('p1')).toBe(true)
  })

  it('normalizes later row updates with deleted project ids without losing their newer data', () => {
    const row = rowOf({ id: 't1', projectId: 'p1', rev: 8 })
    const state = stateOf(projectRemoveOf(), upsertOf(row))
    expect(state.rows.get('t1')?.projectId).toBeNull()
    expect(state.rows.get('t1')?.thread.projectId).toBeNull()
    expect(state.rows.get('t1')?.rev).toBe(8)
    expect(row.thread.projectId).toBe('p1')
    const threadOnly = rowOf({ id: 'other', thread: threadOf({ id: 'other', projectId: 'p1' }) })
    expect(
      applyLiveFrame({ state, frame: upsertOf(threadOnly) }).state.rows.get('other')?.thread
        .projectId,
    ).toBeNull()
  })

  it('does not resurrect a deleted project until the next snapshot', () => {
    const state = stateOf(projectRemoveOf())
    expect(applyLiveFrame({ state, frame: projectRemoveOf() }).state).toBe(state)
    const frame = projectUpsertOf({ ...projectOf('p1'), updatedAt: agoIso(0) })
    expect(applyLiveFrame({ state, frame }).state).toBe(state)
    const reset = applyLiveFrame({ state, frame: snapshotOf() }).state
    expect(applyLiveFrame({ state: reset, frame }).state.projects.has('p1')).toBe(true)
  })

  it('ignores buffered older and equal project updates after a snapshot, but accepts newer ones', () => {
    const project = { ...projectOf('p1'), name: 'new', updatedAt: agoIso(1) }
    const state = stateOf(snapshotOf({ projects: [project] }))
    for (const updatedAt of [agoIso(2), agoIso(1)]) {
      const frame = projectUpsertOf({ ...project, name: 'stale', updatedAt })
      expect(applyLiveFrame({ state, frame }).state).toBe(state)
    }
    const frame = projectUpsertOf({ ...project, name: 'newest', updatedAt: agoIso(0) })
    const next = applyLiveFrame({ state, frame }).state
    expect(next.projects.get('p1')?.name).toBe('newest')
    const stale = projectUpsertOf(project)
    expect(applyLiveFrame({ state: next, frame: stale }).state).toBe(next)
  })
})

describe('applyLiveFrame resync and heartbeat', () => {
  it('flags resync without touching the state', () => {
    const state = emptyLiveList()
    const result = applyLiveFrame({
      state,
      frame: { type: EThreadLiveFrame.Resync, reason: 'overflow' },
    })
    expect(result).toEqual({ state, resync: true })
    expect(result.state).toBe(state)
  })

  it('treats heartbeat as a no-op', () => {
    const state = emptyLiveList()
    const result = applyLiveFrame({ state, frame: { type: EThreadLiveFrame.Heartbeat } })
    expect(result).toEqual({ state, resync: false })
    expect(result.state).toBe(state)
  })
})

describe('entriesOf', () => {
  it('orders roots by sortAt descending and recursively orders siblings by createdAt ascending', () => {
    const rows = [
      rowOf({ id: 'old', sortAt: agoIso(2) }),
      rowOf({ id: 'fresh', sortAt: agoIso(0) }),
      rowOf({
        id: 'child-new',
        managedBySessionId: 'ses_fresh',
        thread: threadOf({ id: 'child-new', createdAt: agoIso(1) }),
      }),
      rowOf({
        id: 'grand-new',
        managedBySessionId: 'ses_child-old',
        thread: threadOf({ id: 'grand-new', createdAt: agoIso(1) }),
      }),
      rowOf({
        id: 'child-old',
        managedBySessionId: 'ses_fresh',
        thread: threadOf({ id: 'child-old', createdAt: agoIso(3) }),
      }),
      rowOf({
        id: 'grand-old',
        managedBySessionId: 'ses_child-old',
        thread: threadOf({ id: 'grand-old', createdAt: agoIso(3) }),
      }),
      rowOf({ id: 'great-grandchild', managedBySessionId: 'ses_grand-old' }),
    ]
    const entries = entriesOf(stateOf(snapshotOf({ rows })))
    expect(entries).toHaveLength(1)
    expect(entries[0]?.project).toBeNull()
    const sessions = entries[0]?.sessions ?? []
    expect(sessions.map((node) => node.mainThread.id)).toEqual(['fresh', 'old'])
    expect(sessions[0]?.id).toBe('ses_fresh')
    expect(sessions[0]?.teammates.map((node) => node.mainThread.id)).toEqual([
      'child-old',
      'child-new',
    ])
    const grandchildren = sessions[0]?.teammates[0]?.teammates ?? []
    expect(grandchildren.map((node) => node.mainThread.id)).toEqual(['grand-old', 'grand-new'])
    expect(grandchildren[0]?.teammates[0]?.mainThread.id).toBe('great-grandchild')
  })

  it('keeps descendants with their root despite different or missing project ids', () => {
    const state = stateOf(
      snapshotOf({
        projects: [projectOf('p1'), projectOf('p2')],
        rows: [
          rowOf({ id: 'root', projectId: 'p1' }),
          rowOf({ id: 'child', projectId: 'p2', managedBySessionId: 'ses_root' }),
          rowOf({ id: 'grandchild', managedBySessionId: 'ses_child' }),
          rowOf({ id: 'loose' }),
          rowOf({ id: 'loose-child', projectId: 'unknown', managedBySessionId: 'ses_loose' }),
        ],
      }),
    )
    const entries = entriesOf(state)
    expect(entries[0]?.sessions[0]?.teammates[0]?.teammates[0]?.mainThread.id).toBe('grandchild')
    expect(entries[1]?.sessions).toEqual([])
    expect(entries[2]?.sessions[0]?.teammates[0]?.mainThread.id).toBe('loose-child')
  })

  it('orders projects by createdAt and keeps every named project alongside projectless rows', () => {
    const first = projectOf('p1')
    const later = { ...projectOf('p2'), createdAt: new Date(NOW).toISOString() }
    const state = stateOf(snapshotOf({ projects: [later, first] }))
    expect(entriesOf(state).map((entry) => entry.project?.id ?? null)).toEqual(['p1', 'p2', null])
    const next = applyLiveFrame({ state, frame: upsertOf(rowOf({ id: 'loose' })) }).state
    const entries = entriesOf(next)
    expect(entries.map((entry) => entry.project?.id ?? null)).toEqual(['p1', 'p2', null])
    expect(entries[0]?.sessions).toEqual([])
    expect(entries[1]?.sessions).toEqual([])
    expect(entries[2]?.sessions[0]?.mainThread.id).toBe('loose')
  })
})
