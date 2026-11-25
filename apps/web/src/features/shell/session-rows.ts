import { nestPeers as nestPeerRows } from '@dltech/atlas-client/stream'
import type { SessionSummary } from '@dltech/atlas-protocol'
import type { WireThread } from '@dltech/atlas-wire/web'

import { rowPullRequestEntryOf } from '@/features/sessions/data/session-view-model'

import type { ProjectThreads, ShellSessionNode } from './thread-partition'
import type { RowView } from './row-status'

export const sessionHref = (sessionId: string): string =>
  `/sessions/${encodeURIComponent(sessionId)}`

const rowViewOf = (summary: SessionSummary): RowView => ({
  status: summary.status?.state,
  sandboxStatus: summary.sandbox?.status,
  branch: summary.primaryBranch ?? undefined,
  routineId: summary.routineId ?? undefined,
  sandboxProvider: summary.sandboxProvider,
  lastAssistantSeq: summary.lastAssistantSeq ?? 0,
  readSeq: summary.readSeq ?? null,
  pullRequest:
    summary.pullRequest === null || summary.pullRequest === undefined
      ? undefined
      : rowPullRequestEntryOf(summary.pullRequest),
})

export function rowOf(summary: SessionSummary): ShellSessionNode {
  const mainThread: WireThread = {
    id: summary.sessionId,
    sessionId: summary.sessionId,
    ...(summary.title === null ? {} : { title: summary.title }),
    head: 0,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    archivedAt: summary.archivedAt,
    workspace: null,
    repo: null,
    projectId: summary.projectId,
  }
  return {
    id: summary.sessionId,
    mainThread,
    teammates: [],
    naming: summary.naming,
    view: rowViewOf(summary),
    ...(summary.spawnedBy === null || summary.spawnedBy === undefined
      ? {}
      : { spawnedBy: summary.spawnedBy }),
    nested: summary.nested ?? true,
  }
}

const createdStampOf = (row: ShellSessionNode): number => {
  const parsed = Date.parse(row.mainThread.createdAt)
  return Number.isNaN(parsed) ? 0 : parsed
}

const byCreatedAt = (left: ShellSessionNode, right: ShellSessionNode): number =>
  createdStampOf(left) - createdStampOf(right)

type Childed = ShellSessionNode & {
  sessionId: string
  archivedAt: string | null
  children: readonly Childed[]
}

const nodeOf = (row: Childed): ShellSessionNode => {
  const { children, sessionId: _sessionId, archivedAt: _archivedAt, ...rest } = row
  return { ...rest, teammates: children.map(nodeOf) }
}

export function nestPeers(rows: readonly ShellSessionNode[]): ShellSessionNode[] {
  const ordered = [...rows]
    .sort(byCreatedAt)
    .map((row) => ({ ...row, sessionId: row.id, archivedAt: row.mainThread.archivedAt }))
  return (nestPeerRows(ordered) as readonly Childed[]).map(nodeOf)
}

export function mergeSessions(args: {
  entries: ProjectThreads[]
  sessions: readonly SessionSummary[]
}): ProjectThreads[] {
  if (args.sessions.length === 0) return args.entries
  return args.entries.map((entry) => {
    const projectId = entry.project?.id ?? null
    const rows = nestPeers(
      args.sessions.filter((summary) => (summary.projectId ?? null) === projectId).map(rowOf),
    )
    return rows.length === 0 ? entry : { ...entry, sessions: [...entry.sessions, ...rows] }
  })
}
