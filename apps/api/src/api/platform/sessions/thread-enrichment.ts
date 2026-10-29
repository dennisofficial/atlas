import { db, type Row } from '@dltech/atlas-db'
import { threadPullRequests, threadWorktree } from './places'
import { withPullRequestStates } from './pull-request-state'
import { toThreadDto } from './rows'
import type { ThreadDto } from './sessions.types'
import { threadStatuses } from './thread-status'
import { threadsSubscriptions } from './thread-subscriptions'

export async function enrichThreads(args: {
  rows: readonly Row<'Thread'>[]
  viewerId: string
}): Promise<ThreadDto[]> {
  const { rows } = args
  const places = await Promise.all(
    rows.map(async (row) => {
      const [worktree, pullRequests] = await Promise.all([
        threadWorktree({ reader: db, threadId: row.id }),
        threadPullRequests({ reader: db, threadId: row.id }),
      ])
      return { row, worktree, pullRequests }
    }),
  )
  const subscriptionsByThread = await threadsSubscriptions({
    reader: db,
    threadIds: rows.map((row) => row.id),
  })
  const statuses = await threadStatuses({ rows, viewerId: args.viewerId })
  const stated = await withPullRequestStates(places.map((entry) => entry.pullRequests))
  return places.map(({ row, worktree }, index) => {
    const pullRequests = stated[index] ?? []
    const subscriptions = (subscriptionsByThread.get(row.id) ?? []).map(
      ({ provider, target, status }) => ({ provider, target, status }),
    )
    const status = statuses.get(row.id)
    return {
      ...toThreadDto(row),
      ...(status === undefined ? {} : { status }),
      ...(worktree === null ? {} : { worktree }),
      ...(pullRequests.length === 0 ? {} : { pullRequests }),
      ...(subscriptions.length === 0 ? {} : { subscriptions }),
    }
  })
}
