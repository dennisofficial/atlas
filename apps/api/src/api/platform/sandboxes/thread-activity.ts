import type { SandboxActivityPost } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'

export async function applyThreadActivity(args: {
  threadId: string
  activity: SandboxActivityPost
}): Promise<boolean> {
  const { threadId, activity } = args
  const row = await db.orm.public.Thread.where({ id: threadId }).first()
  if (row === null) return false
  const lastOutcome = activity.working ? null : (activity.lastOutcome ?? row.lastOutcome)
  const unchanged =
    row.working === activity.working &&
    row.awaiting === activity.awaiting &&
    row.lastOutcome === lastOutcome
  if (unchanged) return false
  await db.orm.public.Thread.where({ id: threadId }).update({
    working: activity.working,
    awaiting: activity.awaiting,
    lastOutcome,
    activityAt: new Date(),
  })
  return true
}
