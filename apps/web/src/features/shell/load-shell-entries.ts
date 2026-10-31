import { ERunner } from '@dltech/atlas-core'
import type { WireThread } from '@dltech/atlas-wire/web'

import type { LocalThread } from '@/features/desktop/local-thread-wire'

import { applyActivityOverrides, type ActivityOverrides } from './activity-overrides'
import { withCreatedThreads } from './created-threads'
import { mainThreadsOf, type ProjectThreads } from './thread-partition'

export function shellEntriesOf(args: {
  entries: ProjectThreads[]
  created: readonly WireThread[]
  overrides: ActivityOverrides
}): ProjectThreads[] {
  const entries = withCreatedThreads(args)
  const localIds = new Set(
    entries
      .flatMap((entry) => mainThreadsOf(entry.sessions))
      .filter((thread) => thread.runner === ERunner.Local)
      .map((thread) => thread.id),
  )
  const overrides = new Map([...args.overrides].filter(([id]) => !localIds.has(id)))
  return applyActivityOverrides({ entries, overrides })
}

export type LocalEntriesLoad = { threads: readonly LocalThread[]; error: unknown }

export function createLocalEntriesLoader(args: {
  load: () => Promise<readonly LocalThread[]>
  previousThreads?: readonly LocalThread[] | undefined
}): () => Promise<LocalEntriesLoad> {
  let threads = args.previousThreads ?? []
  return async () => {
    try {
      threads = await args.load()
      return { threads, error: null }
    } catch (error) {
      return { threads, error }
    }
  }
}
