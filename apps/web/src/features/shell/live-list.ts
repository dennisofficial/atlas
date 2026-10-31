import {
  EThreadLiveFrame,
  type LiveThreadRow,
  type Project,
  type ThreadLiveFrame,
  type WireSessionNode,
} from '@dltech/atlas-wire/web'

import type { ProjectThreads } from './thread-partition'

export type LiveListState = {
  rows: Map<string, LiveThreadRow>
  removedRevs: Map<string, number>
  projects: Map<string, Project>
  deletedProjectIds: Set<string>
  ready: boolean
}

export const emptyLiveList = (): LiveListState => ({
  rows: new Map(),
  removedRevs: new Map(),
  projects: new Map(),
  deletedProjectIds: new Set(),
  ready: false,
})

const projectlessRow = (row: LiveThreadRow): LiveThreadRow => ({
  ...row,
  projectId: null,
  thread: { ...row.thread, projectId: null },
})

const upsert = ({ state, row }: { state: LiveListState; row: LiveThreadRow }): LiveListState => {
  const held = state.rows.get(row.thread.id)
  const removedRev = state.removedRevs.get(row.thread.id)
  if (held !== undefined && row.rev <= held.rev) return state
  if (removedRev !== undefined && row.rev <= removedRev) return state
  const deletedProject = [row.projectId, row.thread.projectId].some(
    (id) => id != null && state.deletedProjectIds.has(id),
  )
  const normalized = deletedProject ? projectlessRow(row) : row
  return { ...state, rows: new Map(state.rows).set(row.thread.id, normalized) }
}

const remove = ({
  state,
  frame,
}: {
  state: LiveListState
  frame: { threadId: string; rev: number }
}): LiveListState => {
  const held = state.rows.get(frame.threadId)
  const removedRev = state.removedRevs.get(frame.threadId)
  if (held !== undefined && frame.rev < held.rev) return state
  if (removedRev !== undefined && frame.rev <= removedRev) return state
  const rows = new Map(state.rows)
  rows.delete(frame.threadId)
  return { ...state, rows, removedRevs: new Map(state.removedRevs).set(frame.threadId, frame.rev) }
}

const upsertProject = ({
  state,
  project,
}: {
  state: LiveListState
  project: Project
}): LiveListState => {
  if (state.deletedProjectIds.has(project.id)) return state
  const held = state.projects.get(project.id)
  if (held !== undefined && epochOf(project.updatedAt) <= epochOf(held.updatedAt)) return state
  return { ...state, projects: new Map(state.projects).set(project.id, project) }
}

const removeProject = ({
  state,
  projectId,
}: {
  state: LiveListState
  projectId: string
}): LiveListState => {
  if (state.deletedProjectIds.has(projectId)) return state
  const projects = new Map(state.projects)
  projects.delete(projectId)
  const rows = new Map(state.rows)
  for (const [id, row] of rows) {
    if (row.projectId === projectId || row.thread.projectId === projectId) {
      rows.set(id, projectlessRow(row))
    }
  }
  return {
    ...state,
    rows,
    projects,
    deletedProjectIds: new Set(state.deletedProjectIds).add(projectId),
  }
}

export function applyLiveFrame({
  state,
  frame,
}: {
  state: LiveListState
  frame: ThreadLiveFrame
}): { state: LiveListState; resync: boolean } {
  switch (frame.type) {
    case EThreadLiveFrame.Snapshot: {
      const rows = new Map<string, LiveThreadRow>()
      for (const row of frame.rows) rows.set(row.thread.id, row)
      const projects = new Map<string, Project>()
      for (const project of frame.projects) projects.set(project.id, project)
      return { state: { ...emptyLiveList(), rows, projects, ready: true }, resync: false }
    }
    case EThreadLiveFrame.Upsert:
      return { state: upsert({ state, row: frame.row }), resync: false }
    case EThreadLiveFrame.Remove:
      return { state: remove({ state, frame }), resync: false }
    case EThreadLiveFrame.ProjectUpsert:
      return { state: upsertProject({ state, project: frame.project }), resync: false }
    case EThreadLiveFrame.ProjectRemove:
      return { state: removeProject({ state, projectId: frame.projectId }), resync: false }
    case EThreadLiveFrame.Resync:
      return { state, resync: true }
    case EThreadLiveFrame.Heartbeat:
      return { state, resync: false }
  }
}

const epochOf = (stamp: string): number => {
  const parsed = Date.parse(stamp)
  return Number.isNaN(parsed) ? 0 : parsed
}

const nodeOf = ({
  row,
  byManager,
}: {
  row: LiveThreadRow
  byManager: ReadonlyMap<string, LiveThreadRow[]>
}): WireSessionNode => ({
  id: row.sessionId,
  mainThread: row.thread,
  teammates: (byManager.get(row.sessionId) ?? [])
    .sort((left, right) => epochOf(left.thread.createdAt) - epochOf(right.thread.createdAt))
    .map((child) => nodeOf({ row: child, byManager })),
})

export function entriesOf(state: LiveListState): ProjectThreads[] {
  const byProject = new Map<string | null, LiveThreadRow[]>()
  const byManager = new Map<string, LiveThreadRow[]>()
  for (const row of state.rows.values()) {
    if (row.managedBySessionId !== null) {
      const siblings = byManager.get(row.managedBySessionId) ?? []
      siblings.push(row)
      byManager.set(row.managedBySessionId, siblings)
      continue
    }
    const rows = byProject.get(row.projectId) ?? []
    rows.push(row)
    byProject.set(row.projectId, rows)
  }
  const sessionsOf = (projectId: string | null): WireSessionNode[] =>
    (byProject.get(projectId) ?? [])
      .sort((left, right) => epochOf(right.sortAt) - epochOf(left.sortAt))
      .map((row) => nodeOf({ row, byManager }))
  const grouped: ProjectThreads[] = [...state.projects.values()]
    .sort((left, right) => epochOf(left.createdAt) - epochOf(right.createdAt))
    .map((project) => ({ project, sessions: sessionsOf(project.id) }))
  return [...grouped, { project: null, sessions: sessionsOf(null) }]
}
