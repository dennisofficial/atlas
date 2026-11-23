import {
  type ESessionDisplay,
  isSessionUnreadOf,
  sessionDisplayOf,
} from '@dltech/atlas-client/stream'
import type { SessionListOutput } from '@dltech/atlas-protocol'

export type V2SessionSummary = SessionListOutput['sessions'][number]

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
  title: string
  projectName: string
  createdAt: string
  updatedAt: string
  status: ESessionDisplay | undefined
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

const placementOf = ({
  projectId,
  nameOf,
}: {
  projectId: string | null
  nameOf: ReadonlyMap<string, string>
}): { key: string; name: string } | undefined => {
  const name = projectId === null ? NO_PROJECT_NAME : nameOf.get(projectId)
  return name === undefined ? undefined : { key: projectId ?? NO_PROJECT_KEY, name }
}

const isRootSession = ({
  summary,
  byId,
}: {
  summary: V2SessionSummary
  byId: ReadonlyMap<string, V2SessionSummary>
}): boolean => {
  if (summary.nested === false) return true
  const spawnerId = summary.spawnedBy ?? null
  if (spawnerId === null || spawnerId === summary.sessionId) return true
  const spawner = byId.get(spawnerId)
  return spawner === undefined || isSet(spawner.archivedAt)
}

const bucketOf = ({ summary, now }: { summary: V2SessionSummary; now: number }): EBucket => {
  if (isSet(summary.archivedAt)) return EBucket.Archived
  const updatedAt = Date.parse(summary.updatedAt)
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

const workOf = (summary: V2SessionSummary): SessionWork => {
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

const entryOf = ({
  summary,
  projectName,
}: {
  summary: V2SessionSummary
  projectName: string
}): ISessionEntry => {
  const display = sessionDisplayOf({
    state: summary.status?.state,
    sandboxStatus: summary.sandbox?.status,
  })
  return {
    id: summary.sessionId,
    title: summary.title === null || summary.title.length === 0 ? 'Untitled' : summary.title,
    projectName,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    status: display,
    unread: isSessionUnreadOf({
      display,
      lastAssistantSeq: summary.lastAssistantSeq ?? 0,
      readSeq: summary.readSeq ?? null,
    }),
    work: workOf(summary),
  }
}

export const sortSessions = (sessions: readonly ISessionEntry[]): ISessionEntry[] =>
  [...sessions].sort((left, right) => timeOf(left.createdAt) - timeOf(right.createdAt))

export const partitionSessions = ({
  projects,
  sessions,
  now,
}: {
  projects: readonly IProjectSummary[]
  sessions: readonly V2SessionSummary[]
  now: number
}): ISessionPartition => {
  const ordered = [...projects].sort(
    (left, right) => timeOf(left.createdAt) - timeOf(right.createdAt),
  )
  const nameOf = new Map(ordered.map((project) => [project.id, project.name]))
  const byId = new Map(sessions.map((summary) => [summary.sessionId, summary]))
  const buckets: Record<EBucket, Map<string, ISessionEntry[]>> = {
    [EBucket.Active]: new Map(),
    [EBucket.Inactive]: new Map(),
    [EBucket.Archived]: new Map(),
  }
  for (const summary of sessions) {
    if (!isRootSession({ summary, byId })) continue
    const placement = placementOf({ projectId: summary.projectId, nameOf })
    if (placement === undefined) continue
    const bucket = buckets[bucketOf({ summary, now })]
    bucket.set(placement.key, [
      ...(bucket.get(placement.key) ?? []),
      entryOf({ summary, projectName: placement.name }),
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
