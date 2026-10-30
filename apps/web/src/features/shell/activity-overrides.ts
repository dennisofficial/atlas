import { useSyncExternalStore } from 'react'

import type { ThreadListActivity, WireThread } from '@dltech/atlas-wire/web'

import type { SessionNode } from '@/features/threads/data/threads-api'
import { timeoutSchedule, type Schedule } from '@/features/threads/data/thread-signals'

import type { ProjectThreads } from './thread-partition'

export const PENDING_WORKING_TTL_MS = 30_000

export type ActivityOverride = {
  activity: Partial<ThreadListActivity>
  at: number
  pending: boolean
}
export type ActivityOverrides = ReadonlyMap<string, ActivityOverride>

const NO_OVERRIDES: ActivityOverrides = new Map()

const WORKING: ThreadListActivity = {
  working: true,
  awaiting: null,
  lastOutcome: null,
}

const overriddenThread = (args: {
  thread: WireThread
  overrides: ActivityOverrides
}): WireThread => {
  const { thread } = args
  const override = args.overrides.get(thread.id)
  if (override === undefined || thread.status === undefined) return thread
  if (override.pending && thread.status.podState === 'booting') return thread
  return { ...thread, status: { ...thread.status, ...override.activity } }
}

const overriddenSession = (args: {
  session: SessionNode
  overrides: ActivityOverrides
}): SessionNode => ({
  ...args.session,
  mainThread: overriddenThread({
    thread: args.session.mainThread,
    overrides: args.overrides,
  }),
  teammates: args.session.teammates.map((teammate) =>
    overriddenSession({ session: teammate, overrides: args.overrides }),
  ),
})

export function applyActivityOverrides(args: {
  entries: ProjectThreads[]
  overrides: ActivityOverrides
}): ProjectThreads[] {
  const { entries, overrides } = args
  if (overrides.size === 0) return entries
  return entries.map(({ project, sessions }) => ({
    project,
    sessions: sessions.map((session) => overriddenSession({ session, overrides })),
  }))
}

export function createActivityOverrides(args: { now: () => number; schedule?: Schedule }) {
  const schedule = args.schedule ?? timeoutSchedule
  let current: ActivityOverrides = NO_OVERRIDES
  const listeners = new Set<() => void>()
  const replace = (next: ActivityOverrides) => {
    current = next.size === 0 ? NO_OVERRIDES : next
    for (const listener of listeners) listener()
  }
  const set = (update: { threadId: string; override: ActivityOverride }) => {
    replace(new Map(current).set(update.threadId, update.override))
    return update.override
  }
  const revert = (args: { threadId: string; override: ActivityOverride }) => {
    if (current.get(args.threadId) !== args.override) return
    const next = new Map(current)
    next.delete(args.threadId)
    replace(next)
  }
  return {
    record: (update: { threadId: string; activity: Partial<ThreadListActivity> }) =>
      set({
        threadId: update.threadId,
        override: { activity: update.activity, at: args.now(), pending: false },
      }),
    markWorking: (threadId: string): ActivityOverride | undefined => {
      if (current.get(threadId)?.activity.working === true) return undefined
      const override = set({
        threadId,
        override: { activity: WORKING, at: args.now(), pending: true },
      })
      schedule({
        delayMs: PENDING_WORKING_TTL_MS,
        run: () => revert({ threadId, override }),
      })
      return override
    },
    clearPending: (threadId: string) => {
      const held = current.get(threadId)
      if (held?.pending === true) revert({ threadId, override: held })
    },
    revert,
    settleBefore: (loadStartedAt: number) => {
      const kept = [...current].filter(
        ([, override]) => override.pending || override.at >= loadStartedAt,
      )
      if (kept.length !== current.size) replace(new Map(kept))
    },
    snapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

export const activityOverrides = createActivityOverrides({
  now: () => Date.now(),
})

export const useActivityOverrides = (): ActivityOverrides =>
  useSyncExternalStore(
    activityOverrides.subscribe,
    activityOverrides.snapshot,
    activityOverrides.snapshot,
  )
