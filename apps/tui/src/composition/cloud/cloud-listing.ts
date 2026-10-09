import { EExecutionLocation, projectOf, toThreadId } from '@dltech/atlas-core'
import {
  THREAD_LISTING_LIMIT,
  type ThreadStorePort,
  type ThreadSummary,
  type WireThread,
} from '@dltech/atlas-harness'

import type { AtlasApp } from '../compose'

type ListingApp = Pick<AtlasApp, 'threads' | 'cloud' | 'workspace'>

export function cloudListing(app: ListingApp): Pick<ThreadStorePort, 'list'> {
  return {
    list: async ({ project, limit, onUpdate, enrich }) => {
      if (enrich !== undefined) return app.threads.list({ project, limit, onUpdate, enrich })
      const session = app.cloud.session()
      const cap = limit ?? THREAD_LISTING_LIMIT
      const remoteRequest = session === null
        ? Promise.resolve([])
        : app.cloud.sessionsClient({ session })
          .listThreads({ project: projectOf(app.workspace), limit: THREAD_LISTING_LIMIT })
          .catch(() => [])
      let local: readonly ThreadSummary[] = []
      let remoteRows: readonly ThreadSummary[] = []
      let localReady = false
      const publish = (): void => {
        if (!localReady && remoteRows.length === 0) return
        onUpdate?.(mergedRows({ local, remote: remoteRows, limit: cap }))
      }
      const localRequest = app.threads.list({
        project,
        limit: cap,
        ...(onUpdate === undefined ? {} : {
          onUpdate: (rows: readonly ThreadSummary[]) => {
            local = rows
            localReady = true
            publish()
          },
        }),
      }).then((rows) => {
        local = rows
        localReady = true
        publish()
      })
      await Promise.all([
        localRequest,
        remoteRequest.then(async (remote) => {
          const stubbed = await Promise.all(remote.map((wire) => stubInto({ app, wire }).catch(() => undefined)))
          remoteRows = stubbed.filter((row): row is ThreadSummary => row !== undefined)
          publish()
        }),
      ])
      return mergedRows({ local, remote: remoteRows, limit: cap })
    },
  }
}

function mergedRows(args: {
  local: readonly ThreadSummary[]
  remote: readonly ThreadSummary[]
  limit: number
}): ThreadSummary[] {
  const known = new Map(args.remote.map((row) => [row.id, row]))
  for (const row of args.local) known.set(row.id, row)
  return [...known.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, args.limit)
}

const stubInto = async (args: { app: ListingApp; wire: WireThread }): Promise<ThreadSummary> => {
  const existing = await args.app.threads.find({ threadId: toThreadId(args.wire.id) })
  if (existing !== undefined) return existing

  const created = await args.app.threads.create({
    id: toThreadId(args.wire.id),
    ...(args.wire.title === undefined ? {} : { title: args.wire.title }),
    workspace: args.wire.workspace ?? projectOf(args.app.workspace),
    repo: args.wire.repo,
    executionLocation: EExecutionLocation.Cloud,
  })
  return {
    ...created,
    createdAt: args.wire.createdAt,
    updatedAt: args.wire.updatedAt,
    // The stub's transcript holds no pull-request-linked events, so `list` cannot fold the links
    // out of it; the wire row already carries them, and the parked-cloud forwarder matches on them.
    ...(args.wire.pullRequests === undefined ? {} : { pullRequests: args.wire.pullRequests }),
  }
}
