import type { Project, WireThread } from '@dltech/atlas-wire/web'

import type { SessionNode } from '@/features/threads/data/threads-api'

export const INACTIVE_AFTER_MS = 72 * 60 * 60 * 1000

export enum EThreadBucket {
  Active = 'active',
  Inactive = 'inactive',
  Archived = 'archived',
}

export const NO_PROJECT_KEY = '__no-project__'
export const NO_PROJECT_NAME = 'No project'

export interface ProjectThreads {
  project: Project | null
  sessions: SessionNode[]
}

export const projectKeyOf = (project: Project | null): string => project?.id ?? NO_PROJECT_KEY

export const projectNameOf = (project: Project | null): string => project?.name ?? NO_PROJECT_NAME

export interface ThreadPartition {
  groups: ProjectThreads[]
  inactive: ProjectThreads[]
  archived: ProjectThreads[]
}

const isSet = (stamp: string | null | undefined): boolean => stamp !== null && stamp !== undefined

const createdAtOf = (thread: WireThread): number => {
  const parsed = Date.parse(thread.createdAt)
  return Number.isNaN(parsed) ? 0 : parsed
}

export function bucketOf(args: { thread: WireThread; now: number }): EThreadBucket {
  const { thread, now } = args
  if (isSet(thread.archivedAt)) return EThreadBucket.Archived
  if (isSet(thread.pinnedAt)) return EThreadBucket.Active
  const updatedAt = Date.parse(thread.updatedAt)
  if (Number.isNaN(updatedAt)) return EThreadBucket.Active
  return now - updatedAt > INACTIVE_AFTER_MS ? EThreadBucket.Inactive : EThreadBucket.Active
}

export function sortSessions(sessions: readonly SessionNode[]): SessionNode[] {
  return [...sessions].sort((left, right) => {
    const pinned =
      Number(isSet(right.mainThread.pinnedAt)) - Number(isSet(left.mainThread.pinnedAt))
    return pinned !== 0 ? pinned : createdAtOf(left.mainThread) - createdAtOf(right.mainThread)
  })
}

const withSessions = (entries: ProjectThreads[]): ProjectThreads[] =>
  entries.filter((entry) => entry.sessions.length > 0)

export function partitionThreads(args: {
  entries: readonly ProjectThreads[]
  now: number
}): ThreadPartition {
  const groups: ProjectThreads[] = []
  const inactive: ProjectThreads[] = []
  const archived: ProjectThreads[] = []
  for (const { project, sessions } of args.entries) {
    const byBucket: Record<EThreadBucket, SessionNode[]> = {
      [EThreadBucket.Active]: [],
      [EThreadBucket.Inactive]: [],
      [EThreadBucket.Archived]: [],
    }
    for (const session of sortSessions(sessions)) {
      byBucket[bucketOf({ thread: session.mainThread, now: args.now })].push(session)
    }
    groups.push({ project, sessions: byBucket[EThreadBucket.Active] })
    inactive.push({ project, sessions: byBucket[EThreadBucket.Inactive] })
    archived.push({ project, sessions: byBucket[EThreadBucket.Archived] })
  }
  return {
    groups: groups.filter((entry) => entry.project !== null || entry.sessions.length > 0),
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
