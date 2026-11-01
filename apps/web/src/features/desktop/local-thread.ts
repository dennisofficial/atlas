import { ERunner } from '@dltech/atlas-core'
import type { ThreadDisplay } from '@/features/threads/data/thread-display'

import type { SessionNode as WireSessionNode } from '@/features/threads/data/threads-api'

import { ELocalActivityState, type LocalThread } from './local-thread-wire'

export function localThreadOf(thread: LocalThread): ThreadDisplay {
  return {
    id: thread.threadId,
    head: thread.head,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    ...(thread.activityState === ELocalActivityState.Available ? { status: thread.status } : {}),
    localAvailability:
      thread.activityState === ELocalActivityState.Available
        ? {
            activityState: thread.activityState,
            lastAssistantSeq: thread.lastAssistantSeq,
            readSeq: thread.readSeq,
          }
        : {
            activityState: thread.activityState,
            lastAssistantSeq: thread.lastAssistantSeq,
            ...(thread.readSeq === undefined ? {} : { readSeq: thread.readSeq }),
            reason: thread.reason,
          },
    workspace: null,
    repo: null,
    projectId: thread.projectId,
    runner: ERunner.Local,
    ...(thread.title === undefined ? {} : { title: thread.title }),
    ...(thread.model === undefined || thread.effort === undefined
      ? {}
      : { model: { ref: thread.model, effort: thread.effort } }),
  }
}

export const localSessionOf = (thread: LocalThread): WireSessionNode => ({
  id: `local_${thread.threadId}`,
  mainThread: localThreadOf(thread),
  teammates: [],
})

type ProjectlessEntry = { project: null; sessions: WireSessionNode[] }

export function withLocalThreads<
  T extends { project: { id: string } | null; sessions: WireSessionNode[] },
>(args: { entries: T[]; threads: readonly LocalThread[] }): (T | ProjectlessEntry)[] {
  if (args.threads.length === 0) return args.entries
  const roots = new Map(args.threads.map((thread) => [thread.threadId, thread]))
  const withoutMirrors = (sessions: WireSessionNode[]): WireSessionNode[] =>
    sessions
      .filter((session) => !roots.has(session.mainThread.id))
      .map((session) => ({
        ...session,
        teammates: withoutMirrors(session.teammates),
      }))
  const entries: (T | ProjectlessEntry)[] = args.entries.map((entry) => ({
    ...entry,
    sessions: withoutMirrors(entry.sessions),
  }))
  for (const thread of roots.values()) {
    let target = entries.find(
      (entry) => entry.project !== null && entry.project.id === thread.projectId,
    )
    target ??= entries.find((entry) => entry.project === null)
    if (target === undefined) {
      target = { project: null, sessions: [] }
      entries.push(target)
    }
    target.sessions.push(localSessionOf(thread))
  }
  return entries
}
