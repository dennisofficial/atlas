import { useSyncExternalStore } from 'react'

import type { WireThread } from '@dltech/atlas-wire/web'

import { hasThread, type ProjectThreads } from './thread-partition'

export function withCreatedThreads(args: {
  entries: ProjectThreads[]
  created: readonly WireThread[]
}): ProjectThreads[] {
  const pending = args.created.filter(
    (thread) =>
      !hasThread({ entries: args.entries, threadId: thread.id }) &&
      args.entries.some((entry) => entry.project.id === thread.projectId),
  )
  if (pending.length === 0) return args.entries
  return args.entries.map((entry) => {
    const mine = pending.filter((thread) => thread.projectId === entry.project.id)
    if (mine.length === 0) return entry
    const added = mine.map((thread) => ({
      id: thread.sessionId ?? thread.id,
      mainThread: thread,
      teammates: [],
    }))
    return { ...entry, sessions: [...entry.sessions, ...added] }
  })
}

export function createCreatedThreads() {
  let current: readonly WireThread[] = []
  const listeners = new Set<() => void>()
  const replace = (next: readonly WireThread[]) => {
    current = next
    for (const listener of listeners) listener()
  }
  return {
    announce: (thread: WireThread) => {
      replace([...current.filter((held) => held.id !== thread.id), thread])
    },
    forgetListed: (entries: readonly ProjectThreads[]) => {
      const kept = current.filter((thread) => !hasThread({ entries, threadId: thread.id }))
      if (kept.length !== current.length) replace(kept)
    },
    snapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

export const createdThreads = createCreatedThreads()

export const useCreatedThreads = (): readonly WireThread[] =>
  useSyncExternalStore(createdThreads.subscribe, createdThreads.snapshot, createdThreads.snapshot)
