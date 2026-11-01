import { db } from '@dltech/atlas-db'
import type { ThreadWithSession } from './thread-with-session'
import { threadsPullRequests, threadWorktrees } from './places'
import { spawnedPullRequestsByThread } from './spawned-pull-requests'
import { withPullRequestStates } from './pull-request-state'
import { toThreadDto } from './rows'
import type { LinkedPullRequestDto, ThreadDto } from './sessions.types'
import { threadStatuses } from './thread-status'
import { threadsSubscriptions } from './thread-subscriptions'

async function pullRequestStatesByThread(args: { threadIds: string[]; viewerId: string }) {
  const { threadIds, viewerId } = args
  const [own, spawned] = await Promise.all([
    threadsPullRequests({ reader: db, threadIds }),
    spawnedPullRequestsByThread({ reader: db, threadIds }),
  ])
  const groups = threadIds.map((id): LinkedPullRequestDto[] => {
    const ownPullRequests = own.get(id) ?? []
    const ownKeys = new Set(ownPullRequests.map((pr) => `${pr.repo}#${pr.number}`))
    return [
      ...ownPullRequests,
      ...(spawned.get(id) ?? []).filter((pr) => !ownKeys.has(`${pr.repo}#${pr.number}`)),
    ]
  })
  return withPullRequestStates({ groups, viewerId })
}

export async function enrichThreads(args: {
  rows: readonly ThreadWithSession[]
  viewerId: string
}): Promise<ThreadDto[]> {
  const threadIds = args.rows.map(({ thread }) => thread.id)
  const [worktrees, stated, subscriptionsByThread, statuses] = await Promise.all([
    threadWorktrees({ reader: db, threadIds }),
    pullRequestStatesByThread({ threadIds, viewerId: args.viewerId }),
    threadsSubscriptions({ reader: db, threadIds }),
    threadStatuses({ rows: args.rows, viewerId: args.viewerId }),
  ])
  return args.rows.map(({ thread: row, session }, index) => {
    const worktree = worktrees.get(row.id) ?? null
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
