import { ERunner } from '@dltech/atlas-core'
import type { WireThread } from '@dltech/atlas-wire/web'

import { withLocalThreads } from '@/features/desktop/local-thread'
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

type ShellLoad = {
  entries: ProjectThreads[]
  startedAt: number
  localThreads: readonly LocalThread[]
  localError: unknown
  cloudError: unknown
}

type ShellSources = {
  cloud: () => Promise<ProjectThreads[]>
  local: () => Promise<readonly LocalThread[]>
}

export function createShellEntriesLoader(args: ShellSources): () => Promise<ShellLoad> {
  let previousLocal: readonly LocalThread[] = []
  return () =>
    loadShellEntries({
      ...args,
      previousLocal,
      local: async () => {
        const threads = await args.local()
        previousLocal = threads
        return threads
      },
    })
}

export async function loadShellEntries(
  args: ShellSources & {
    previousLocal?: readonly LocalThread[]
  },
): Promise<ShellLoad> {
  const startedAt = Date.now()
  const [cloud, local] = await Promise.allSettled([args.cloud(), args.local()])
  const threads = local.status === 'fulfilled' ? local.value : (args.previousLocal ?? [])
  if (cloud.status === 'rejected' && local.status === 'fulfilled' && threads.length === 0) {
    throw cloud.reason
  }
  const entries = cloud.status === 'fulfilled' ? cloud.value : []
  return {
    entries: withLocalThreads({ entries, threads }),
    startedAt,
    localThreads: threads,
    localError: local.status === 'rejected' ? local.reason : null,
    cloudError: cloud.status === 'rejected' ? cloud.reason : null,
  }
}
