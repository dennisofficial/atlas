import { db, or } from '@dltech/atlas-db'
import { threadsPullRequests } from '../../platform/sessions/places'
import { dtoOf } from './github-delivery-routing'
import type { GithubPrStateDto } from './github-realtime.types'

export type LinkedPr = {
  repoFullName: string
  prNumber: number
  userIds: string[]
}

import { normalizedRepo, repoPattern, prIdentity } from './github-pr-identity'
export { normalizedRepo, repoPattern, prIdentity } from './github-pr-identity'

export async function linkedPrs(args: { userId: string }): Promise<LinkedPr[]> {
  const threads = await db.orm.public.Thread.where({ userId: args.userId })
    .select('id', 'userId')
    .all()
  if (threads.length === 0) return []
  const links = await threadsPullRequests({
    reader: db,
    threadIds: threads.map((thread) => thread.id),
  })
  const byIdentity = new Map<string, LinkedPr>()
  for (const thread of threads) {
    for (const link of links.get(thread.id) ?? []) {
      const repoFullName = normalizedRepo(link.repo)
      if (!/^[\w.-]+\/[\w.-]+$/.test(repoFullName)) continue
      if (!Number.isSafeInteger(link.number) || link.number < 1) continue
      const key = prIdentity({ repoFullName, prNumber: link.number })
      const held = byIdentity.get(key)
      if (held === undefined) {
        byIdentity.set(key, { repoFullName, prNumber: link.number, userIds: [thread.userId] })
      } else if (!held.userIds.includes(thread.userId)) {
        held.userIds.push(thread.userId)
      }
    }
  }
  return [...byIdentity.values()]
}

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
