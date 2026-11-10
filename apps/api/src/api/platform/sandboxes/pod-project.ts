import { db } from '@dltech/atlas-db'

/**
 * The Vercel project a session's sandbox actually lives in. Vercel scopes every sandbox call to a
 * project, so a pod keeps the one it was created in even after its owner's credential moves to a
 * different project — that is what makes credential rotation gradual instead of a fleet cutover.
 */
export async function pinnedProjectOf(args: { sessionId: string }): Promise<string | null> {
  const row = await db.orm.public.CloudSandbox.where({ sessionId: args.sessionId })
    .select('vercelProjectId')
    .first()
  return row?.vercelProjectId ?? null
}

/** Records where a sandbox was created, so later resumes, renewals and stops find it there. */
export async function pinPodProject(args: { sessionId: string; projectId: string }): Promise<void> {
  await db.orm.public.CloudSandbox.where({ sessionId: args.sessionId })
    .select('id')
    .update({ vercelProjectId: args.projectId, updatedAt: new Date() })
}
