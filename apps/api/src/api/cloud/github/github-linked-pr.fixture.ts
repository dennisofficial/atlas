import { db } from '@dltech/atlas-db'
import { seedThread } from '@dltech/atlas-db/testing'
import { ensureUser } from '../../../../test/github-seed'

export async function seedLinkedPr(
  args: { userId?: string; threadId?: string; number?: number; repo?: string } = {},
): Promise<void> {
  const userId = args.userId ?? 'usr-owner'
  const threadId = args.threadId ?? `thr-${userId}`
  await ensureUser(userId)
  if ((await db.orm.public.Thread.first({ id: threadId })) === null) {
    await seedThread({ db, id: threadId, userId })
  }
  const prior = await db.orm.public.Event.where({ threadId })
    .orderBy((event) => event.seq.desc())
    .first()
  await db.orm.public.Event.create({
    id: `evt-${threadId}-${(prior?.seq ?? 0) + 1}`,
    userId,
    runId: 'run-link',
    depth: 0,
    threadId,
    seq: (prior?.seq ?? 0) + 1,
    type: 'pull-request-linked',
    body: JSON.stringify({
      number: args.number ?? 42,
      repo: args.repo ?? 'github.com/compai/app',
      branch: 'dennis/add-the-thing',
      url: `https://github.com/compai/app/pull/${args.number ?? 42}`,
    }),
    at: new Date(),
  })
}
