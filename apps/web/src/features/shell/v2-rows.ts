import type { SessionListOutput } from '@dltech/atlas-protocol'
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
  }
}

export function v2SessionIdsOf(
  entries: readonly ProjectThreads[] | undefined,
): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const { sessions } of entries ?? []) {
    for (const session of sessions) if (isV2Session(session)) ids.add(session.id)
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
    const rows = args.sessions.filter((summary) => summary.projectId === projectId).map(v2RowOf)
    return rows.length === 0 ? entry : { ...entry, sessions: [...entry.sessions, ...rows] }
  })
}
