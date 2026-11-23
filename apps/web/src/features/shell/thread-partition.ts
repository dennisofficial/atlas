import {
  EPeerBucket,
  INACTIVE_AFTER_MS,
  isRecentProject as isRecentlyActiveProject,
  lastActivityAt,
  peerBucketOf,
} from '@dltech/atlas-client/stream'
import type { Project, WireThread } from '@dltech/atlas-wire/web'

import type { SessionNode } from '@/features/threads/data/threads-api'

import type { V2RowView } from './v2-status'

export { INACTIVE_AFTER_MS }

export { EPeerBucket as EThreadBucket } from '@dltech/atlas-client/stream'

export const NO_PROJECT_KEY = '__no-project__'
export const NO_PROJECT_NAME = 'No project'

export type ShellSessionNode = SessionNode & {
  v2?: true
  naming?: boolean
  v2View?: V2RowView
  spawnedBy?: string
  nested?: boolean
}

export interface ProjectThreads {
  project: Project | null
  sessions: ShellSessionNode[]
}

export const projectKeyOf = (project: Project | null): string => project?.id ?? NO_PROJECT_KEY

export const projectNameOf = (project: Project | null): string => project?.name ?? NO_PROJECT_NAME

export interface ThreadPartition {
  groups: ProjectThreads[]
  inactive: ProjectThreads[]
  archived: ProjectThreads[]
}

const isSet = (stamp: string | null | undefined): stamp is string =>
  stamp !== null && stamp !== undefined

const createdAtOf = (thread: WireThread): number => {
  const parsed = Date.parse(thread.createdAt)
  return Number.isNaN(parsed) ? 0 : parsed
}

export const bucketOf = (args: { thread: WireThread; now: number }): EPeerBucket =>
  peerBucketOf({ row: args.thread, now: args.now })

export function sortSessions(sessions: readonly SessionNode[]): SessionNode[] {
  return [...sessions].sort((left, right) => {
    const pinned =
      Number(isSet(right.mainThread.pinnedAt)) - Number(isSet(left.mainThread.pinnedAt))
    return pinned !== 0 ? pinned : createdAtOf(left.mainThread) - createdAtOf(right.mainThread)
  })
}

const withSessions = (entries: ProjectThreads[]): ProjectThreads[] =>
  entries.filter((entry) => entry.sessions.length > 0)

const activityStampsOf = (entry: ProjectThreads): (string | null | undefined)[] =>
  mainThreadsOf(entry.sessions).flatMap((thread) => [thread.updatedAt, thread.archivedAt])

export function lastActivityOf(entry: ProjectThreads): number {
  return lastActivityAt({ createdAt: entry.project?.createdAt, stamps: activityStampsOf(entry) })
}

const isRecentProject = (args: { entry: ProjectThreads; now: number }): boolean =>
  args.entry.project !== null &&
  isRecentlyActiveProject({
    createdAt: args.entry.project.createdAt,
    stamps: activityStampsOf(args.entry),
    now: args.now,
  })

export function partitionThreads(args: {
  entries: readonly ProjectThreads[]
  now: number
}): ThreadPartition {
  const groups: ProjectThreads[] = []
  const inactive: ProjectThreads[] = []
  const archived: ProjectThreads[] = []
  for (const entry of args.entries) {
    const { project, sessions } = entry
    const byBucket: Record<EPeerBucket, SessionNode[]> = {
      [EPeerBucket.Active]: [],
      [EPeerBucket.Inactive]: [],
      [EPeerBucket.Archived]: [],
    }
    for (const session of sortSessions(sessions)) {
      byBucket[bucketOf({ thread: session.mainThread, now: args.now })].push(session)
    }
    const active = byBucket[EPeerBucket.Active]
    if (active.length > 0 || isRecentProject({ entry, now: args.now })) {
      groups.push({ project, sessions: active })
    }
    inactive.push({ project, sessions: byBucket[EPeerBucket.Inactive] })
    archived.push({ project, sessions: byBucket[EPeerBucket.Archived] })
  }
  return {
    groups,
    inactive: withSessions(inactive),
    archived: withSessions(archived),
  }
}

export const countThreads = (entries: readonly ProjectThreads[]): number =>
  entries.reduce((total, entry) => total + entry.sessions.length, 0)

export function mainThreadsOf(sessions: readonly SessionNode[]): WireThread[] {
  return sessions.flatMap((session) => [session.mainThread, ...mainThreadsOf(session.teammates)])
}

export const hasThread = (args: {
  entries: readonly ProjectThreads[]
  threadId: string
}): boolean =>
  args.entries.some((entry) =>
    mainThreadsOf(entry.sessions).some((thread) => thread.id === args.threadId),
  )

export function descendantsOfThread(args: {
  entries: readonly ProjectThreads[]
  threadId: string
}): WireThread[] {
  const find = (sessions: readonly SessionNode[]): SessionNode | undefined => {
    for (const session of sessions) {
      if (session.mainThread.id === args.threadId) return session
      const nested = find(session.teammates)
      if (nested !== undefined) return nested
    }
    return undefined
  }
  const node = find(args.entries.flatMap((entry) => entry.sessions))
  return node === undefined ? [] : mainThreadsOf(node.teammates)
}
