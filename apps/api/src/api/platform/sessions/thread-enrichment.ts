import { db } from '@dltech/atlas-db'
import type { ThreadWithSession } from './thread-with-session'
import { threadPullRequests, threadWorktree } from './places'
import { spawnedPullRequests } from './spawned-pull-requests'
import { withPullRequestStates } from './pull-request-state'
import { toThreadDto } from './rows'
import type { ThreadDto } from './sessions.types'
import { threadStatuses } from './thread-status'
import { threadsSubscriptions } from './thread-subscriptions'

export async function enrichThreads(args: {
  rows: readonly ThreadWithSession[]
  viewerId: string
}): Promise<ThreadDto[]> {
  const places = await Promise.all(
    args.rows.map(async ({ thread: row, session }) => {
      const [worktree, own, spawned] = await Promise.all([
        threadWorktree({ reader: db, threadId: row.id }),
        threadPullRequests({ reader: db, threadId: row.id }),
        spawnedPullRequests({ reader: db, threadId: row.id }),
      ])
      const ownKeys = new Set(own.map((pr) => `${pr.repo}#${pr.number}`))
      const pullRequests = [
        ...own,
        ...spawned.filter((pr) => !ownKeys.has(`${pr.repo}#${pr.number}`)),
      ]
      return { row, session, worktree, pullRequests }
    }),
  )
  const subscriptionsByThread = await threadsSubscriptions({
    reader: db,
    threadIds: args.rows.map(({ thread }) => thread.id),
  })
  const statuses = await threadStatuses({ rows: args.rows, viewerId: args.viewerId })
  const stated = await withPullRequestStates(places.map((entry) => entry.pullRequests))
  return places.map(({ row, session, worktree }, index) => {
    const pullRequests = stated[index] ?? []
    const subscriptions = (subscriptionsByThread.get(row.id) ?? []).map(
      ({ provider, target, status }) => ({ provider, target, status }),
    )
    const status = statuses.get(row.id)
    return {
      ...toThreadDto({ thread: row, session }),
      ...(status === undefined ? {} : { status }),
      ...(worktree === null ? {} : { worktree }),
      ...(pullRequests.length === 0 ? {} : { pullRequests }),
      ...(subscriptions.length === 0 ? {} : { subscriptions }),
    }
  })
}
