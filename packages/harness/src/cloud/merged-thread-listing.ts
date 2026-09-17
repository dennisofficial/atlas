import type { ThreadId } from '@dltech/atlas-core'

import type { ThreadStorePort, ThreadSummary } from '../store/thread-store'

type ThreadReads = Pick<ThreadStorePort, 'list' | 'find'>

export type MergedThreadListing = {
  list(args: { project: string; limit?: number | undefined }): Promise<readonly ThreadSummary[]>
  find(args: { threadId: ThreadId }): Promise<ThreadSummary | undefined>
}

const union = (args: {
  local: readonly ThreadSummary[]
  remote: readonly ThreadSummary[]
  limit?: number | undefined
}): readonly ThreadSummary[] => {
  const knownRemotely = new Set(args.remote.map((row) => row.id))
  const rows = [
    ...args.remote,
    ...args.local.filter((row) => !knownRemotely.has(row.id)),
  ]
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return args.limit === undefined ? rows : rows.slice(0, args.limit)
}

const remoteOr = async <T>(args: { remote: () => Promise<T>; fallback: T }): Promise<T> => {
  try {
    return await args.remote()
  } catch {
    return args.fallback
  }
}

/**
 * The read model behind the thread picker: a thread is a thread wherever it runs, so the list is
 * the union of the local store and the cloud store, and location is a fact on the row rather than
 * a mode the picker is in. The cloud being down never costs the local list.
 */
export function mergedThreadListing(args: {
  local: ThreadReads
  remote: ThreadReads
}): MergedThreadListing {
  const { local, remote } = args

  return {
    async list({ project, limit }) {
      const remoteRows = await remoteOr({ remote: () => remote.list({ project }), fallback: [] })
      const localRows = await local.list({ project, ...(limit === undefined ? {} : { limit }) })
      return union({ local: localRows, remote: remoteRows, ...(limit === undefined ? {} : { limit }) })
    },

    async find({ threadId }) {
      const remoteRow = await remoteOr({ remote: () => remote.find({ threadId }), fallback: undefined })
      if (remoteRow !== undefined) return remoteRow
      return local.find({ threadId })
    },
  }
}
