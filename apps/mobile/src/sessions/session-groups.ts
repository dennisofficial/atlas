import {
  type ESessionDisplay,
  EPeerBucket,
  isRecentProject,
  isSessionUnreadOf,
  nestPeers,
  type PeerTreeNode,
  peerBucketOf,
  sessionDisplayOf,
} from '@dltech/atlas-client/stream'
import type { SessionListOutput } from '@dltech/atlas-protocol'

export type V2SessionSummary = SessionListOutput['sessions'][number]

export type SessionPullRequest = NonNullable<V2SessionSummary['pullRequest']>

export const NO_PROJECT_KEY = '__no-project__'
export const NO_PROJECT_NAME = 'No project'

export enum EWorkKind {
  PullRequest = 'pull-request',
  Branch = 'branch',
}

export type SessionWork =
  | { kind: EWorkKind.PullRequest; pullRequest: SessionPullRequest }
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
  archivedAt: string | null
  status: ESessionDisplay | undefined
  unread: boolean
  work: SessionWork
  children: ISessionEntry[]
}

export interface IProjectGroup {
  key: string
  name: string
  projectId: string | null
  sessions: ISessionEntry[]
}

export interface ISessionPartition {
  groups: IProjectGroup[]
  archived: IProjectGroup[]
}

interface IPlacedProject {
  name: string
  sessions: V2SessionSummary[]
}

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

const placedOf = ({
  sessions,
  nameOf,
}: {
  sessions: readonly V2SessionSummary[]
  nameOf: ReadonlyMap<string, string>
}): Map<string, IPlacedProject> => {
  const placed = new Map<string, IPlacedProject>()
  for (const summary of sessions) {
    const placement = placementOf({ projectId: summary.projectId, nameOf })
    if (placement === undefined) continue
    const current = placed.get(placement.key) ?? { name: placement.name, sessions: [] }
    placed.set(placement.key, { ...current, sessions: [...current.sessions, summary] })
  }
  return placed
}

const workOf = (summary: V2SessionSummary): SessionWork => {
  const pullRequest = summary.pullRequest
  if (pullRequest !== null && pullRequest !== undefined) {
    return { kind: EWorkKind.PullRequest, pullRequest }
  }
  return { kind: EWorkKind.Branch, branch: summary.primaryBranch ?? null }
}

const entryOf = ({
  node,
  projectName,
}: {
  node: PeerTreeNode<V2SessionSummary>
  projectName: string
}): ISessionEntry => {
  const { children, ...summary } = node
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
    archivedAt: summary.archivedAt,
    status: display,
    unread: isSessionUnreadOf({
      display,
      lastAssistantSeq: summary.lastAssistantSeq ?? 0,
      readSeq: summary.readSeq ?? null,
    }),
    work: workOf(summary),
    children: children.map((child) => entryOf({ node: child, projectName })),
  }
}

const byCreated = (left: V2SessionSummary, right: V2SessionSummary): number =>
  timeOf(left.createdAt) - timeOf(right.createdAt)

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
  const placed = placedOf({ sessions, nameOf })
  const entriesOfBucket: Record<EPeerBucket, Map<string, ISessionEntry[]>> = {
    [EPeerBucket.Active]: new Map(),
    [EPeerBucket.Archived]: new Map(),
  }
  for (const [key, project] of placed) {
    for (const node of nestPeers([...project.sessions].sort(byCreated))) {
      const entries = entriesOfBucket[peerBucketOf({ row: node })]
      entries.set(key, [...(entries.get(key) ?? []), entryOf({ node, projectName: project.name })])
    }
  }
  const createdAtOf = new Map(ordered.map((project) => [project.id, project.createdAt]))
  const stampsOf = (key: string): (string | null | undefined)[] =>
    (placed.get(key)?.sessions ?? []).flatMap((summary) => [summary.updatedAt, summary.archivedAt])
  const groupsOf = (bucket: EPeerBucket): IProjectGroup[] => [
    ...ordered.map((project) => ({
      key: project.id,
      name: project.name,
      projectId: project.id,
      sessions: sortSessions(entriesOfBucket[bucket].get(project.id) ?? []),
    })),
    {
      key: NO_PROJECT_KEY,
      name: NO_PROJECT_NAME,
      projectId: null,
      sessions: sortSessions(entriesOfBucket[bucket].get(NO_PROJECT_KEY) ?? []),
    },
  ]
  const isRecentGroup = (group: IProjectGroup): boolean => {
    const createdAt = group.projectId === null ? undefined : createdAtOf.get(group.projectId)
    if (createdAt === undefined) return false
    return isRecentProject({ createdAt, stamps: stampsOf(group.key), now })
  }
  const nonEmpty = (group: IProjectGroup) => group.sessions.length > 0
  return {
    groups: groupsOf(EPeerBucket.Active).filter((group) => nonEmpty(group) || isRecentGroup(group)),
    archived: groupsOf(EPeerBucket.Archived).filter(nonEmpty),
  }
}
