import type { SessionListOutput } from '@dltech/atlas-protocol'
import type { WireThread } from '@dltech/atlas-wire/web'

import { ESessionStatus, isUnread, sessionStatusOf } from './session-status'

export type V2SessionSummary = SessionListOutput['sessions'][number]

export enum ESessionKind {
  V1 = 'v1',
  V2 = 'v2',
}

export const INACTIVE_AFTER_MS = 72 * 60 * 60 * 1000
export const NO_PROJECT_KEY = '__no-project__'
export const NO_PROJECT_NAME = 'No project'

export enum EPullRequestState {
  Open = 'open',
  Draft = 'draft',
  Merged = 'merged',
  Closed = 'closed',
}

export enum EWorkKind {
  PullRequest = 'pull-request',
  Branch = 'branch',
}

export type SessionWork =
  | { kind: EWorkKind.PullRequest; number: number; state: EPullRequestState }
  | { kind: EWorkKind.Branch; branch: string | null }

export interface IProjectSummary {
  id: string
  name: string
  createdAt: string
}

export interface ISessionEntry {
  id: string
  kind: ESessionKind
  title: string
  projectName: string
  createdAt: string
  updatedAt: string
  pinned: boolean
  status: ESessionStatus
  unread: boolean
  work: SessionWork
}

export interface IProjectGroup {
  key: string
  name: string
  projectId: string | null
  sessions: ISessionEntry[]
}

export interface ISessionPartition {
  groups: IProjectGroup[]
  inactive: IProjectGroup[]
  archived: IProjectGroup[]
}

enum EBucket {
  Active = 'active',
  Inactive = 'inactive',
  Archived = 'archived',
}

const isSet = (stamp: string | null | undefined): boolean => stamp !== null && stamp !== undefined

const timeOf = (stamp: string): number => {
  const parsed = Date.parse(stamp)
  return Number.isNaN(parsed) ? 0 : parsed
}

const bucketOf = ({ thread, now }: { thread: WireThread; now: number }): EBucket => {
  if (isSet(thread.archivedAt)) return EBucket.Archived
  if (isSet(thread.pinnedAt)) return EBucket.Active
  const updatedAt = Date.parse(thread.updatedAt)
  if (Number.isNaN(updatedAt)) return EBucket.Active
  return now - updatedAt > INACTIVE_AFTER_MS ? EBucket.Inactive : EBucket.Active
}

const pullRequestStateOf = (state: string | undefined): EPullRequestState => {
  const value = (state ?? '').toLowerCase()
  if (value.includes('merged')) return EPullRequestState.Merged
  if (value.includes('closed')) return EPullRequestState.Closed
  if (value.includes('draft')) return EPullRequestState.Draft
  return EPullRequestState.Open
}

type PullRequest = NonNullable<WireThread['pullRequests']>[number]

const workOf = (thread: WireThread): SessionWork => {
  const latest = (thread.pullRequests ?? []).reduce<PullRequest | undefined>(
    (best, entry) => (best === undefined || entry.number > best.number ? entry : best),
    undefined,
  )
  if (latest !== undefined) {
    return {
      kind: EWorkKind.PullRequest,
      number: latest.number,
      state: pullRequestStateOf(latest.state),
    }
  }
  return {
    kind: EWorkKind.Branch,
    branch: thread.worktree?.branch ?? thread.checkout?.branch ?? null,
  }
}

const isMainSession = (thread: WireThread): boolean =>
  thread.parent === undefined && thread.agent === undefined

export const toSessionEntry = ({
  thread,
  projectName,
}: {
  thread: WireThread
  projectName: string
}): ISessionEntry => ({
  id: thread.id,
  kind: ESessionKind.V1,
  title: thread.title === undefined || thread.title.length === 0 ? 'Untitled' : thread.title,
  projectName,
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
  pinned: isSet(thread.pinnedAt),
  status: sessionStatusOf(thread),
  unread: isUnread(thread),
  work: workOf(thread),
})

const RUNNING_STATES: ReadonlySet<string> = new Set([
  'preparing',
  'sent',
  'thinking',
  'running-tool',
  'waiting-to-retry',
  'resuming',
])

const FAILED_STATES: ReadonlySet<string> = new Set(['failed', 'setup-failed', 'start-failed'])

const statusOfV2 = (summary: V2SessionSummary): ESessionStatus => {
  const state = summary.status?.state
  if (state === undefined) return ESessionStatus.Idle
  if (state === 'waiting-for-credentials') return ESessionStatus.Awaiting
  if (FAILED_STATES.has(state)) return ESessionStatus.Failed
  return RUNNING_STATES.has(state) ? ESessionStatus.Running : ESessionStatus.Idle
}

const workOfV2 = (summary: V2SessionSummary): SessionWork => {
  const pullRequest = summary.pullRequest
  if (pullRequest !== null && pullRequest !== undefined) {
    return {
      kind: EWorkKind.PullRequest,
      number: pullRequest.number,
      state: pullRequestStateOf(pullRequest.state ?? undefined),
    }
  }
  return { kind: EWorkKind.Branch, branch: summary.primaryBranch ?? null }
}

const v2EntryOf = ({
  summary,
  projectName,
}: {
  summary: V2SessionSummary
  projectName: string
}): ISessionEntry => ({
  id: summary.sessionId,
  kind: ESessionKind.V2,
  title: summary.title === null || summary.title.length === 0 ? 'Untitled' : summary.title,
  projectName,
  createdAt: summary.createdAt,
  updatedAt: summary.updatedAt,
  pinned: false,
  status: statusOfV2(summary),
  unread: false,
  work: workOfV2(summary),
})

const v2BucketOf = ({ summary, now }: { summary: V2SessionSummary; now: number }): EBucket => {
  if (isSet(summary.archivedAt)) return EBucket.Archived
  const updatedAt = Date.parse(summary.updatedAt)
  if (Number.isNaN(updatedAt)) return EBucket.Active
  return now - updatedAt > INACTIVE_AFTER_MS ? EBucket.Inactive : EBucket.Active
}

export const sortSessions = (sessions: readonly ISessionEntry[]): ISessionEntry[] =>
  [...sessions].sort((left, right) => {
    const pinned = Number(right.pinned) - Number(left.pinned)
    return pinned !== 0 ? pinned : timeOf(left.createdAt) - timeOf(right.createdAt)
  })

export const partitionSessions = ({
  projects,
  threads,
  sessions,
  now,
}: {
  projects: readonly IProjectSummary[]
  threads: readonly WireThread[]
  sessions?: readonly V2SessionSummary[]
  now: number
}): ISessionPartition => {
  const ordered = [...projects].sort(
    (left, right) => timeOf(left.createdAt) - timeOf(right.createdAt),
  )
  const nameOf = new Map(ordered.map((project) => [project.id, project.name]))
  const buckets: Record<EBucket, Map<string, ISessionEntry[]>> = {
    [EBucket.Active]: new Map(),
    [EBucket.Inactive]: new Map(),
    [EBucket.Archived]: new Map(),
  }
  for (const thread of threads.filter(isMainSession)) {
    const projectId = thread.projectId ?? null
    const projectName = projectId === null ? NO_PROJECT_NAME : nameOf.get(projectId)
    if (projectName === undefined) continue
    const key = projectId ?? NO_PROJECT_KEY
    const bucket = buckets[bucketOf({ thread, now })]
    bucket.set(key, [...(bucket.get(key) ?? []), toSessionEntry({ thread, projectName })])
  }
  for (const summary of sessions ?? []) {
    const projectName = nameOf.get(summary.projectId)
    if (projectName === undefined) continue
    const bucket = buckets[v2BucketOf({ summary, now })]
    bucket.set(summary.projectId, [
      ...(bucket.get(summary.projectId) ?? []),
      v2EntryOf({ summary, projectName }),
    ])
  }
  const groupsOf = (bucket: EBucket): IProjectGroup[] => [
    ...ordered.map((project) => ({
      key: project.id,
      name: project.name,
      projectId: project.id,
      sessions: sortSessions(buckets[bucket].get(project.id) ?? []),
    })),
    {
      key: NO_PROJECT_KEY,
      name: NO_PROJECT_NAME,
      projectId: null,
      sessions: sortSessions(buckets[bucket].get(NO_PROJECT_KEY) ?? []),
    },
  ]
  const nonEmpty = (group: IProjectGroup) => group.sessions.length > 0
  return {
    groups: groupsOf(EBucket.Active).filter((group) => group.projectId !== null || nonEmpty(group)),
    inactive: groupsOf(EBucket.Inactive).filter(nonEmpty),
    archived: groupsOf(EBucket.Archived).filter(nonEmpty),
  }
}
