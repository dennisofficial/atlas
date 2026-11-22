import { db } from '@dltech/atlas-db'
import { threadsPullRequests } from '../../platform/sessions/places'
import { type LinkedPr, normalizedRepo, prIdentity } from './github-linked-prs'

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
