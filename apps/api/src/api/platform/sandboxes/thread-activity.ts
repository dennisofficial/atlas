import type { SandboxActivityPost, ThreadListActivity } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'

const outcomeOf = (value: string | null): ThreadListActivity['lastOutcome'] =>
  value === 'completed' || value === 'failed' || value === 'stopped' ? value : null

export async function applyThreadActivity(args: {
  threadId: string
  activity: SandboxActivityPost
}): Promise<ThreadListActivity | null> {
  const { threadId, activity } = args
  const row = await db.orm.public.Thread.where({ id: threadId }).first()
  if (row === null) return null
  const lastOutcome = activity.working ? null : (activity.lastOutcome ?? row.lastOutcome)
  const waitingForModel =
    activity.waitingForModel === undefined ? row.waitingForModel : activity.waitingForModel
  const unchanged =
    row.working === activity.working &&
    row.awaiting === activity.awaiting &&
    row.lastOutcome === lastOutcome &&
    row.waitingForModel === waitingForModel
  if (unchanged) return null
  await db.orm.public.Thread.where({ id: threadId }).update({
    working: activity.working,
    awaiting: activity.awaiting,
    lastOutcome,
    waitingForModel,
    activityAt: new Date(),
  })
  return {
    working: activity.working,
    awaiting: activity.awaiting,
    lastOutcome: outcomeOf(lastOutcome),
  }
}
