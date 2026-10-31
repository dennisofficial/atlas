import { ERunner, toThreadId, type ThreadId } from '@dltech/atlas-core'
import { createLocalPodTitles, listLocalPodThreads, wireEventOf } from '@dltech/atlas-harness'
import type { ILocalStore } from './local-store'
import { localThreadOf } from './pod-records'
import type { IPodThreads } from './pod-threads'
import type { LocalThread, ThreadEventsQuery, ThreadEventsReply } from './wire'

export interface IThreadReads {
  threads: () => Promise<LocalThread[]>
  rename: (args: { threadId: string; title: string }) => Promise<boolean>
  events: (args: {
    threadId: string
    query: ThreadEventsQuery
  }) => Promise<ThreadEventsReply | undefined>
  readCursor: (args: { threadId: string }) => Promise<number | null | undefined>
  markRead: (args: { threadId: string; seq: number }) => Promise<number | undefined>
}

export function createThreadReads({
  store,
  pods,
}: {
  store: ILocalStore
  pods: Pick<IPodThreads, 'channel'>
}): IThreadReads {
  const known = async (threadId: string): Promise<ThreadId | undefined> => {
    const record = await store.threads.find({ threadId: toThreadId(threadId) })
    return record?.runner === ERunner.Local ? record.id : undefined
  }

  return {
    threads: async () => {
      const records = await listLocalPodThreads({ home: store.home })
      return Promise.all(
        records.map(async (record) =>
          localThreadOf({ record, readSeq: await store.cursor.readSeq({ threadId: record.id }) }),
        ),
      )
    },
    rename: async ({ threadId, title }) => {
      const id = await known(threadId)
      if (id === undefined) return false
      await createLocalPodTitles({
        home: store.home,
        threadId: id,
        channel: () => pods.channel({ threadId: id }),
      }).rename({ title })
      return true
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
  }
}
