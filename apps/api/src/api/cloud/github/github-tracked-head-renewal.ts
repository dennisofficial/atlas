import { and, db, or } from '@dltech/atlas-db'
import { TRACKING_TARGET_TTL_MS } from '@dltech/atlas-plugin-github/control'

import { normalizedRepo } from './github-pr-identity'

const headKey = (args: { repoFullName: string; branch: string }): string =>
  `${normalizedRepo(args.repoFullName)}#${args.branch}`

export async function renewTrackedHeadTargets(args: { now?: Date }): Promise<void> {
  const now = args.now ?? new Date()
  const renewedUntil = new Date(now.getTime() + TRACKING_TARGET_TTL_MS)
  const held = await db.orm.public.GithubTrackingTarget.where((target) =>
    target.liveUntil.gt(now),
  ).all()
  const heads = held.filter((target) => target.kind === 'head')
  if (heads.length === 0) return
  const tracked = await db.orm.v2.V2SessionBranch.where((branch) =>
    or(
      ...heads.map((head) =>
        and(branch.headRepo.eq(normalizedRepo(head.repoFullName)), branch.branch.eq(head.branch)),
      ),
    ),
  ).all()
  if (tracked.length === 0) return
  const sessionIds = [...new Set(tracked.map((row) => row.sessionId))]
  const sessions = await db.orm.v2.V2Session.where((session) =>
    and(
      session.archivedAt.isNull(),
      or(...sessionIds.map((sessionId) => session.id.eq(sessionId))),
    ),
  )
    .select('id')
    .all()
  const alive = new Set(sessions.map((session) => session.id))
  const live = new Set(
    tracked
      .filter((row) => alive.has(row.sessionId))
      .map((row) => headKey({ repoFullName: row.headRepo, branch: row.branch })),
  )
  for (const head of heads) {
    if (!live.has(headKey(head))) continue
    if (head.liveUntil.getTime() >= renewedUntil.getTime()) continue
    await db.orm.public.GithubTrackingTarget.where({ id: head.id }).update({
      liveUntil: renewedUntil,
    })
  }
}
