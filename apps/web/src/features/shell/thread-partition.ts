import type { Project, WireThread } from '@dltech/atlas-wire/web'

export const INACTIVE_AFTER_MS = 72 * 60 * 60 * 1000

export enum EThreadBucket {
  Active = 'active',
  Inactive = 'inactive',
  Archived = 'archived',
}

export interface ProjectThreads {
  project: Project
  threads: WireThread[]
}

export interface ThreadPartition {
  groups: ProjectThreads[]
  inactive: ProjectThreads[]
  archived: ProjectThreads[]
}

const isSet = (stamp: string | null | undefined): boolean => stamp !== null && stamp !== undefined

const updatedAtOf = (thread: WireThread): number => {
  const parsed = Date.parse(thread.updatedAt)
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

export function sortThreads(threads: readonly WireThread[]): WireThread[] {
  return [...threads].sort((left, right) => {
    const pinned = Number(isSet(right.pinnedAt)) - Number(isSet(left.pinnedAt))
    return pinned !== 0 ? pinned : updatedAtOf(right) - updatedAtOf(left)
  })
}

const withThreads = (entries: ProjectThreads[]): ProjectThreads[] =>
  entries.filter((entry) => entry.threads.length > 0)

export function partitionThreads(args: {
  entries: readonly ProjectThreads[]
  now: number
}): ThreadPartition {
  const groups: ProjectThreads[] = []
  const inactive: ProjectThreads[] = []
  const archived: ProjectThreads[] = []
  for (const { project, threads } of args.entries) {
    const byBucket: Record<EThreadBucket, WireThread[]> = {
      [EThreadBucket.Active]: [],
      [EThreadBucket.Inactive]: [],
      [EThreadBucket.Archived]: [],
    }
    for (const thread of sortThreads(threads)) {
      byBucket[bucketOf({ thread, now: args.now })].push(thread)
    }
    groups.push({ project, threads: byBucket[EThreadBucket.Active] })
    inactive.push({ project, threads: byBucket[EThreadBucket.Inactive] })
    archived.push({ project, threads: byBucket[EThreadBucket.Archived] })
  }
  return {
    groups,
    inactive: withThreads(inactive),
    archived: withThreads(archived),
  }
}

export const countThreads = (entries: readonly ProjectThreads[]): number =>
  entries.reduce((total, entry) => total + entry.threads.length, 0)

export const hasThread = (args: {
  entries: readonly ProjectThreads[]
  threadId: string
}): boolean =>
  args.entries.some((entry) => entry.threads.some((thread) => thread.id === args.threadId))
