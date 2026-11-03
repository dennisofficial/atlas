import type { WireThread } from '@dltech/atlas-wire/web'

import { ESessionStatus, sessionStatusOf } from './session-status'

export const INACTIVE_AFTER_MS = 72 * 60 * 60 * 1000

export interface IProjectSummary {
  id: string
  name: string
}

export interface ISessionEntry {
  id: string
  title: string
  projectName: string
  updatedAt: string
  status: ESessionStatus
  detail: string | null
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

const detailOf = (thread: WireThread): string | null => {
  const pullRequest = thread.pullRequests?.[0]
  if (pullRequest !== undefined) {
    const state = pullRequest.state === undefined ? '' : ` ${pullRequest.state.toLowerCase()}`
    return `#${pullRequest.number}${state}`
  }
  return thread.worktree?.branch ?? thread.checkout?.branch ?? null
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
  title: thread.title === undefined || thread.title.length === 0 ? 'Untitled' : thread.title,
  projectName,
  updatedAt: thread.updatedAt,
  status: sessionStatusOf(thread),
  detail: detailOf(thread),
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
  const nameOf = new Map(projects.map((project) => [project.id, project.name]))
  const active = new Map<string, ISessionEntry[]>(projects.map((project) => [project.id, []]))
  const inactive: ISessionEntry[] = []
  const archived: ISessionEntry[] = []
  for (const thread of threads.filter(isMainSession)) {
    const projectId = thread.projectId ?? null
    if (projectId === null) continue
    const projectName = nameOf.get(projectId)
    if (projectName === undefined) continue
    const entry = toSessionEntry({ thread, projectName })
    const bucket = bucketOf({ thread, now })
    if (bucket === EBucket.Archived) archived.push(entry)
    else if (bucket === EBucket.Inactive) inactive.push(entry)
    else active.get(projectId)?.push(entry)
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
