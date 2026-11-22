import { db, or } from '@dltech/atlas-db'
import { dtoOf } from './github-delivery-routing'
import type { GithubPrStateDto } from './github-realtime.types'

export type LinkedPr = {
  repoFullName: string
  prNumber: number
  userIds: string[]
}

import { normalizedRepo, repoPattern, prIdentity } from './github-pr-identity'
export { normalizedRepo, repoPattern, prIdentity } from './github-pr-identity'

export async function cachedPrStates(
  prs: readonly {
    repoFullName: string
    prNumber: number
  }[],
): Promise<GithubPrStateDto[]> {
  if (prs.length === 0) return []
  const keys = new Set(prs.map(prIdentity))
  const patterns = [...new Set(prs.map((pr) => repoPattern(pr.repoFullName)))]
  const rows = await db.orm.public.GithubPrState.where((pr) =>
    or(...patterns.map((pattern) => pr.repoFullName.ilike(pattern))),
  )
    .where((pr) => pr.prNumber.in([...new Set(prs.map((pr) => pr.prNumber))]))
    .orderBy((pr) => pr.updatedAt.asc())
    .all()
  const states = new Map(
    rows
      .filter((row) => keys.has(prIdentity(row)))
      .map((row) => [
        prIdentity(row),
        { ...dtoOf(row), repoFullName: normalizedRepo(row.repoFullName) },
      ]),
  )
  return [...states.values()]
}
