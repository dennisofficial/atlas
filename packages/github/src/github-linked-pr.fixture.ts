import { db } from '@dltech/atlas-db'
import { ensureUser } from './testing/github-seed'
import { normalizedRepo } from './github-pr-identity'

export async function seedLinkedPr(
  args: { userId?: string; threadId?: string; number?: number; repo?: string } = {},
): Promise<void> {
  const userId = args.userId ?? 'usr-owner'
  const threadId = args.threadId ?? `thr-${userId}`
  const number = args.number ?? 42
  const repo = args.repo ?? 'github.com/compai/app'
  await ensureUser(userId)
  await seedSessionLink({ userId, threadId, number, repo })
}

/**
 * The link outlives the subscription that created it: plugins/github `subscription-created` writes
 * a SessionPullRequest row that nothing deletes when the lease lapses, and that row is what the
 * session view and the change announcement read.
 */
async function seedSessionLink(args: {
  userId: string
  threadId: string
  number: number
  repo: string
}): Promise<void> {
  const sessionId = `ses_${args.threadId}`
  if ((await db.orm.public.Session.first({ id: sessionId })) === null) {
    await db.orm.public.Session.create({
      id: sessionId,
      userId: args.userId,
      projectId: null,
      title: null,
      titledFromInboxId: null,
      mainThreadId: args.threadId,
      nextInboxId: 1,
      createdAt: new Date(),
      archivedAt: null,
      modelRef: 'anthropic/claude-haiku-4-5',
      modelEffort: 'medium',
      modelFast: false,
      sandboxProvider: 'vercel',
      credentialSource: 'platform',
      spawnedBySessionId: null,
      nested: true,
      podSessionId: null,
    })
  }
  await db.orm.public.SessionPullRequest.create({
    sessionId,
    repoFullName: normalizedRepo(args.repo),
    prNumber: args.number,
  })
}
