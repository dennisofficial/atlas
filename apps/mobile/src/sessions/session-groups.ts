import type { WireThread } from '@dltech/atlas-wire/web'

import { type ESessionStatus, isUnread, sessionStatusOf } from './session-status'

export const INACTIVE_AFTER_MS = 72 * 60 * 60 * 1000

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
}

export interface ISessionEntry {
  id: string
  title: string
  projectId: string
  projectName: string
  updatedAt: string
  status: ESessionStatus
  unread: boolean
  work: SessionWork
}

export interface IProjectGroup {
  key: string
  name: string
  sessions: ISessionEntry[]
}

export interface ISessionPartition {
  groups: IProjectGroup[]
  inactive: ISessionEntry[]
  archived: ISessionEntry[]
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
  return now - timeOf(thread.updatedAt) > INACTIVE_AFTER_MS ? EBucket.Inactive : EBucket.Active
}

const pullRequestStateOf = (state: string | undefined): EPullRequestState => {
  const value = (state ?? '').toLowerCase()
  if (value.includes('merged')) return EPullRequestState.Merged
  if (value.includes('closed')) return EPullRequestState.Closed
  if (value.includes('draft')) return EPullRequestState.Draft
  return EPullRequestState.Open
}

const workOf = (thread: WireThread): SessionWork => {
  const latest = (thread.pullRequests ?? []).reduce<
    NonNullable<WireThread['pullRequests']>[number] | undefined
  >((best, entry) => (best === undefined || entry.number > best.number ? entry : best), undefined)
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
  project,
}: {
  thread: WireThread
  project: IProjectSummary
}): ISessionEntry => ({
  id: thread.id,
  title: thread.title === undefined || thread.title.length === 0 ? 'Untitled' : thread.title,
  projectId: project.id,
  projectName: project.name,
  updatedAt: thread.updatedAt,
  status: sessionStatusOf(thread),
  unread: isUnread(thread),
  work: workOf(thread),
})

const byRecency = (left: ISessionEntry, right: ISessionEntry): number =>
  timeOf(right.updatedAt) - timeOf(left.updatedAt)

const latestOf = (group: IProjectGroup): number => timeOf(group.sessions[0]?.updatedAt ?? '')

export const partitionSessions = ({
  projects,
  threads,
  now,
}: {
  projects: readonly IProjectSummary[]
  threads: readonly WireThread[]
  now: number
}): ISessionPartition => {
  const projectOf = new Map(projects.map((project) => [project.id, project]))
  const active = new Map<string, ISessionEntry[]>(projects.map((project) => [project.id, []]))
  const inactive: ISessionEntry[] = []
  const archived: ISessionEntry[] = []
  for (const thread of threads.filter(isMainSession)) {
    const project = projectOf.get(thread.projectId ?? '')
    if (project === undefined) continue
    const entry = toSessionEntry({ thread, project })
    const bucket = bucketOf({ thread, now })
    if (bucket === EBucket.Archived) archived.push(entry)
    else if (bucket === EBucket.Inactive) inactive.push(entry)
    else active.get(project.id)?.push(entry)
  }
  const groups = projects.map((project) => ({
    key: project.id,
    name: project.name,
    sessions: (active.get(project.id) ?? []).sort(byRecency),
  }))
  const withSessions = groups.filter((group) => group.sessions.length > 0)
  const empty = groups.filter((group) => group.sessions.length === 0)
  return {
    groups: [...withSessions.sort((left, right) => latestOf(right) - latestOf(left)), ...empty],
    inactive: inactive.sort(byRecency),
    archived: archived.sort(byRecency),
  }
}
