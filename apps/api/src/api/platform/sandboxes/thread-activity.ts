import type { SandboxActivityPost, ThreadListActivity } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'

const outcomeOf = (value: string | null): ThreadListActivity['lastOutcome'] =>
  value === 'completed' || value === 'failed' || value === 'stopped' ? value : null

export type ThreadActivityApplied = ThreadListActivity & { activityAt: string }

export type ThreadActivityResult = {
  applied: ThreadActivityApplied
  ended: { outcome: 'completed' | 'failed'; activityAt: string } | null
}

export async function applyThreadActivity(args: {
  threadId: string
  activity: SandboxActivityPost
}): Promise<ThreadActivityResult | null> {
  const { threadId, activity } = args
  const row = await db.orm.public.Thread.where({ id: threadId }).first()
  if (row === null) return null
  const lastOutcome = activity.working ? null : (activity.lastOutcome ?? row.lastOutcome)
  const unchanged =
    row.working === activity.working &&
    row.awaiting === activity.awaiting &&
    row.lastOutcome === lastOutcome
  if (unchanged) return null
  const activityAt = new Date()
  await db.orm.public.Thread.where({ id: threadId }).update({
    working: activity.working,
    awaiting: activity.awaiting,
    lastOutcome,
    activityAt,
  })
  const applied: ThreadActivityApplied = {
    working: activity.working,
    awaiting: activity.awaiting,
    lastOutcome: outcomeOf(lastOutcome),
    activityAt: activityAt.toISOString(),
  }
  const ended =
    row.working === true &&
    activity.working === false &&
    (applied.lastOutcome === 'completed' || applied.lastOutcome === 'failed')
      ? { outcome: applied.lastOutcome, activityAt: applied.activityAt }
      : null
  return { applied, ended }
}
