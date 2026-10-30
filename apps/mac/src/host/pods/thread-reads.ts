import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import { wireEventOf } from '@dltech/atlas-harness'
import type { ILocalStore } from './local-store'
import { listPodRecords, localThreadOf, type PodRecord } from './pod-records'
import type { IPodThreads } from './pod-threads'
import type { LocalThread, ThreadEventsQuery, ThreadEventsReply } from './wire'

export interface IThreadReads {
  threads: () => Promise<LocalThread[]>
  events: (args: {
    threadId: string
    query: ThreadEventsQuery
  }) => Promise<ThreadEventsReply | undefined>
  readCursor: (args: { threadId: string }) => Promise<number | null | undefined>
  markRead: (args: { threadId: string; seq: number }) => Promise<number | undefined>
  rename: (args: { threadId: string; title: string }) => Promise<boolean>
}

export function createThreadReads({
  store,
  pods,
  recordOf,
}: {
  store: ILocalStore
  pods: IPodThreads
  recordOf: (threadId: string) => Promise<PodRecord | undefined>
}): IThreadReads {
  const known = async (threadId: string): Promise<ThreadId | undefined> =>
    (await recordOf(threadId))?.id

  return {
    threads: async () => {
      const records = await listPodRecords({ store })
      return Promise.all(
        records.map(async (record) =>
          localThreadOf({ record, readSeq: await store.cursor.readSeq({ threadId: record.id }) }),
        ),
      )
    },
    events: async ({ threadId, query }) => {
      const id = await known(threadId)
      if (id === undefined) return undefined
      await store.log.refresh({ threadId: id })
      const head = await store.log.head({ threadId: id })
      const upTo = Math.min(head, query.after + query.limit)
      const page = await store.log.read({ threadId: id, fromSeq: query.after, upTo })
      return {
        events: page.map(wireEventOf),
        head,
        nextAfter: upTo < head ? upTo : null,
      }
    },
    readCursor: async ({ threadId }) => {
      const id = await known(threadId)
      if (id === undefined) return undefined
      return (await store.cursor.readSeq({ threadId: id })) ?? null
    },
    markRead: async ({ threadId, seq }) => {
      const id = await known(threadId)
      if (id === undefined) return undefined
      return store.cursor.markRead({ threadId: id, seq })
    },
    rename: async ({ threadId, title }) => {
      const id = await known(threadId)
      if (id === undefined) return false
      await store.threads.rename({ threadId: id, title })
      void pods
        .hold({ threadId: toThreadId(id) })
        .then((pod) => pod.runtime.threads.rename({ threadId: id, title }))
        .catch(() => undefined)
      return true
    },
  }
}
