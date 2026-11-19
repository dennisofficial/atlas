import { ECheckOutcome } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { recordCommitChecksLocked, type CommitCheckInput } from './github-commit-checks'
import { GithubPrOutboxWriter } from './github-pr-outbox'
import { reconcileOutboxEffectsOf } from './github-pr-reconcile-effects'
import { checkIdentitiesOf } from './github-pr-row-fold'

const REPO = 'compai/app'
const HEAD = 'abc123'

const queuedRun = (args: { id: number; at: Date }): CommitCheckInput => ({
  checkKey: `run:${args.id}`,
  sourceId: String(args.id),
  name: 'build',
  startedAt: null,
  outcome: ECheckOutcome.Running,
  sourceUpdatedAt: args.at,
  isRun: true,
  conclusion: null,
})

const reconcileAt = async (at: Date) => {
  await recordCommitChecksLocked({
    repoFullName: REPO,
    headSha: HEAD,
    checks: [queuedRun({ id: 7, at }), queuedRun({ id: 8, at })],
  })
  const rows = await db.orm.public.GithubCommitCheck.where({
    repoFullName: REPO,
    headSha: HEAD,
  }).all()

  return reconcileOutboxEffectsOf({
    attempts: checkIdentitiesOf(rows),
    repoFullName: REPO,
    headSha: HEAD,
  })
}

describe('reconcile effects of a queued rerun', () => {
  useTestDatabase()

  it('keeps one row while the stored timestamp of the same queued run advances', async () => {
    const first = await reconcileAt(new Date('2026-11-18T10:00:00Z'))
    const second = await reconcileAt(new Date('2026-11-18T10:05:00Z'))

    expect(first).toHaveLength(1)
    expect(second.map((effect) => effect.dedupeKey)).toEqual(
      first.map((effect) => effect.dedupeKey),
    )

    await db.transaction((tx) =>
      GithubPrOutboxWriter.write({
        tx,
        repoFullName: REPO,
        prNumber: 42,
        effects: [...first, ...second],
      }),
    )

    expect(await db.orm.public.GithubPrOutbox.all()).toHaveLength(1)
  })
})
