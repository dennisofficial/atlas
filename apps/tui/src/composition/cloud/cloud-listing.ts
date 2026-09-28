import { EExecutionLocation, projectOf, toThreadId } from '@dltech/atlas-core'
import {
  THREAD_LISTING_LIMIT,
  type ThreadStorePort,
  type ThreadSummary,
  type WireThread,
} from '@dltech/atlas-harness'

import type { AtlasApp } from '../compose'

/**
 * The picker's read: local threads always, cloud threads when signed in, merged by id with the
 * local row winning — a lifted thread keeps its flipped local record, and the flipped record is
 * what the router locates. A thread the cloud knows but this machine does not gets materialized as
 * a local stub under the cloud thread's own id, so the router's location lookup finds it, the
 * cloud-open path attaches under the id the sandbox knows, and a later listing on any machine
 * dedupes against the same record. A cloud that refuses or cannot be reached costs the listing
 * nothing: local rows answer alone.
 */
export function cloudListing(app: AtlasApp): Pick<ThreadStorePort, 'list'> {
  return {
    list: async ({ project, limit }) => {
      const local = await app.threads.list({ project })

      const session = app.cloud.session()
      if (session === null) return local

      let remote: WireThread[]
      try {
        remote = await app.cloud
          .sessionsClient({ session })
          .listThreads({ project: projectOf(app.workspace), limit: THREAD_LISTING_LIMIT })
      } catch {
        return local
      }

      const known = new Set(local.map((row) => row.id as string))
      const stubbed: ThreadSummary[] = []
      for (const wire of remote) {
        if (known.has(wire.id)) continue
        stubbed.push(await stubInto({ app, wire }))
      }

      const cap = limit ?? THREAD_LISTING_LIMIT
      return [...local, ...stubbed]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, cap)
    },
  }
}

const stubInto = async (args: { app: AtlasApp; wire: WireThread }): Promise<ThreadSummary> => {
  const existing = await args.app.threads.find({ threadId: toThreadId(args.wire.id) })
  if (existing !== undefined) return existing

  const created = await args.app.threads.create({
    id: toThreadId(args.wire.id),
    ...(args.wire.title === undefined ? {} : { title: args.wire.title }),
    workspace: args.wire.workspace ?? projectOf(args.app.workspace),
    repo: args.wire.repo,
    executionLocation: EExecutionLocation.Cloud,
  })
  return { ...created, createdAt: args.wire.createdAt, updatedAt: args.wire.updatedAt }
}
