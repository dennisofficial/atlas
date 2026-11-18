import { and, db, or, type Row } from '@dltech/atlas-db'
import { normalizedRepo } from './github-linked-prs'

export const oldestAttemptFirst = (
  left: Row<'GithubTrackingTarget'>,
  right: Row<'GithubTrackingTarget'>,
): number => {
  if (left.attemptedAt === null || right.attemptedAt === null) {
    if (left.attemptedAt === null && right.attemptedAt === null) return 0
    return left.attemptedAt === null ? -1 : 1
  }
  return left.attemptedAt.getTime() - right.attemptedAt.getTime()
}

export async function statesOnPolledHeads(
  heads: readonly Row<'GithubTrackingTarget'>[],
): Promise<{ state: Row<'GithubPrState'>; userId: string }[]> {
  if (heads.length === 0) return []
  const userIds = new Map<string, string>()
  for (const head of heads)
    userIds.set(`${normalizedRepo(head.repoFullName)}#${head.branch}`, head.userId)
  const states = await db.orm.public.GithubPrState.where((state) =>
    or(
      ...heads.map((head) =>
        and(
          state.headRepoFullName.eq(normalizedRepo(head.repoFullName)),
          state.headBranch.eq(head.branch),
        ),
      ),
    ),
  ).all()
  return states.flatMap((state) => {
    const key = `${normalizedRepo(state.headRepoFullName ?? '')}#${state.headBranch}`
    const userId = userIds.get(key)
    return userId === undefined ? [] : [{ state, userId }]
  })
}

export const lookupKey = (target: Row<'GithubTrackingTarget'>): string =>
  target.kind === 'head'
    ? `head:${normalizedRepo(target.repoFullName)}#${target.branch}`
    : `${normalizedRepo(target.repoFullName)}#${target.prNumber ?? 0}`
