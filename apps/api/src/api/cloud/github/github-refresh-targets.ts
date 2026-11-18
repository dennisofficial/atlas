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

export const TARGET_BATCH = 200
export const HEAD_STATE_BATCH = 64

export async function liveTrackingTargets(now: Date): Promise<Row<'GithubTrackingTarget'>[]> {
  const unattempted = await db.orm.public.GithubTrackingTarget.where((target) =>
    and(target.liveUntil.gt(now), target.attemptedAt.isNull()),
  )
    .limit(TARGET_BATCH)
    .all()
  const attempted = await db.orm.public.GithubTrackingTarget.where((target) =>
    and(target.liveUntil.gt(now), target.attemptedAt.isNotNull()),
  )
    .orderBy((target) => target.attemptedAt.asc())
    .limit(TARGET_BATCH)
    .all()
  return [...unattempted, ...attempted]
}

export async function statesOnPolledHeads(
  heads: readonly Row<'GithubTrackingTarget'>[],
): Promise<{ state: Row<'GithubPrState'>; userId: string }[]> {
  if (heads.length === 0) return []
  const userIds = new Map<string, string>()
  for (const head of heads)
    userIds.set(`${normalizedRepo(head.repoFullName)}#${head.branch}`, head.userId)
  const states: Row<'GithubPrState'>[] = []
  for (const batch of chunks(heads, HEAD_STATE_BATCH)) states.push(...(await statesOnHeads(batch)))
  return states.flatMap((state) => {
    const key = `${normalizedRepo(state.headRepoFullName ?? '')}#${state.headBranch}`
    const userId = userIds.get(key)
    return userId === undefined ? [] : [{ state, userId }]
  })
}

async function statesOnHeads(heads: readonly Row<'GithubTrackingTarget'>[]) {
  return db.orm.public.GithubPrState.where((state) =>
    or(
      ...heads.map((head) =>
        and(
          state.headRepoFullName.eq(normalizedRepo(head.repoFullName)),
          state.headBranch.eq(head.branch),
        ),
      ),
    ),
  ).all()
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = []
  for (let start = 0; start < items.length; start += size)
    batches.push(items.slice(start, start + size))
  return batches
}

export const lookupKey = (target: Row<'GithubTrackingTarget'>): string =>
  target.kind === 'head'
    ? `head:${normalizedRepo(target.repoFullName)}#${target.branch}`
    : `${normalizedRepo(target.repoFullName)}#${target.prNumber ?? 0}`
