import { db, type Row } from '@dltech/atlas-db'
import { threadPullRequests, threadWorktree } from './places'
import { withPullRequestStates } from './pull-request-state'
import { toThreadDto } from './rows'
import type { ThreadDto } from './sessions.types'

export async function enrichThreads(rows: readonly Row<'Thread'>[]): Promise<ThreadDto[]> {
  const places = await Promise.all(
    rows.map(async (row) => {
      const [worktree, pullRequests] = await Promise.all([
        threadWorktree({ reader: db, threadId: row.id }),
        threadPullRequests({ reader: db, threadId: row.id }),
      ])
      return { row, worktree, pullRequests }
    }),
  )
  const stated = await withPullRequestStates(places.map((entry) => entry.pullRequests))
  return places.map(({ row, worktree }, index) => {
    const pullRequests = stated[index] ?? []
    return {
      ...toThreadDto(row),
      ...(worktree === null ? {} : { worktree }),
      ...(pullRequests.length === 0 ? {} : { pullRequests }),
    }
  })
}
