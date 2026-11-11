import type { SessionListOutput } from '@dltech/atlas-protocol'
import { nestPeers as nestPeerRows } from '@dltech/atlas-plugin-sessions/client'
import type { WireThread } from '@dltech/atlas-wire/web'

import { rowPullRequestEntryOf } from '@/features/sessions/data/session-view-model'

import type { ProjectThreads, ShellSessionNode } from './thread-partition'
import type { V2RowView } from './v2-status'

export type V2SessionSummary = SessionListOutput['sessions'][number]

export const v2SessionHref = (sessionId: string): string =>
  `/sessions/${encodeURIComponent(sessionId)}`

export const isV2Session = (session: ShellSessionNode): boolean => session.v2 === true

const rowViewOf = (summary: V2SessionSummary): V2RowView => ({
  status: summary.status?.state,
  branch: summary.primaryBranch ?? undefined,
  routineId: summary.routineId ?? undefined,
  pullRequest:
    summary.pullRequest === null || summary.pullRequest === undefined
      ? undefined
      : rowPullRequestEntryOf(summary.pullRequest),
})

export function v2RowOf(summary: V2SessionSummary): ShellSessionNode {
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
    v2: true,
    naming: summary.naming,
    v2View: rowViewOf(summary),
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

export function v2SessionIdsOf(
  entries: readonly ProjectThreads[] | undefined,
): ReadonlySet<string> {
  const ids = new Set<string>()
  const visit = (session: ShellSessionNode) => {
    if (isV2Session(session)) ids.add(session.id)
    for (const peer of session.teammates) visit(peer)
  }
  for (const { sessions } of entries ?? []) {
    for (const session of sessions) visit(session)
  }
  return ids
}

export function withV2Sessions(args: {
  entries: ProjectThreads[]
  sessions: readonly V2SessionSummary[]
}): ProjectThreads[] {
  if (args.sessions.length === 0) return args.entries
  return args.entries.map((entry) => {
    if (entry.project === null) return entry
    const projectId = entry.project.id
    const rows = nestPeers(
      args.sessions.filter((summary) => summary.projectId === projectId).map(v2RowOf),
    )
    return rows.length === 0 ? entry : { ...entry, sessions: [...entry.sessions, ...rows] }
  })
}
