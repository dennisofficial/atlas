import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { checkRunInputOf, recordCommitChecksLocked } from './github-commit-checks'
import { applyArgs, pull, rig } from './github-pr-apply.fixture'

describe('GithubPrStore.apply replaying a head it already folded', () => {
  useTestDatabase()

  const seedRun = (args: { id: number; name: string; conclusion: string }) =>
    recordCommitChecksLocked({
      repoFullName: 'compai/app',
      headSha: 'abc123',
      checks: [
        checkRunInputOf({
          id: args.id,
          name: args.name,
          status: 'completed',
          conclusion: args.conclusion,
          started_at: '2026-11-18T09:59:00Z',
          completed_at: '2026-11-18T10:00:00Z',
        }),
      ],
    })

  const outboxRows = () => db.orm.public.GithubPrOutbox.all()

  const reconcileRows = async () =>
    (await outboxRows()).filter((row) => row.kind === 'reconcile-checks')

  it('replays a partially reported required check as unchanged', async () => {
    await db.orm.public.GithubBranchProtection.create({
      repoFullName: 'compai/app',
      baseBranch: 'main',
      requiredContexts: ['ci', 'lint'],
      fetchedAt: new Date(),
    })
    const { store } = rig()
    await store.apply(applyArgs([pull()]))
    await seedRun({ id: 1, name: 'ci', conclusion: 'success' })
    const reported = await store.apply(applyArgs([]))
    expect(reported.row?.checksState).toBe('expected')
    expect(reported.row?.checksPassed).toBe(1)
    const before = await outboxRows()

    const replayed = await store.apply(applyArgs([pull()]))

    expect(replayed.changed).toEqual([])
    expect(replayed.applied).toBe(false)
    expect(await outboxRows()).toHaveLength(before.length)
  })

  it('replays a head whose checks were all ignored as unchanged', async () => {
    const { store } = rig()
    await store.apply(applyArgs([pull()]))
    await seedRun({ id: 1, name: 'ci', conclusion: 'neutral' })
    const settled = await store.apply(applyArgs([]))
    expect(settled.row?.checksState).toBe('success')
    expect(settled.row?.checksIgnored).toBe(1)
    const before = await outboxRows()

    const replayed = await store.apply(applyArgs([pull()]))

    expect(replayed.changed).toEqual([])
    expect(await outboxRows()).toHaveLength(before.length)
  })

  it('writes one reconcile effect for a rerun that changes no visible state', async () => {
    const { store } = rig()
    await store.apply(applyArgs([pull()]))
    await seedRun({ id: 1, name: 'ci', conclusion: 'success' })
    await store.apply(applyArgs([]))
    expect(await reconcileRows()).toHaveLength(0)

    await seedRun({ id: 2, name: 'ci', conclusion: 'success' })
    const rerun = await store.apply(applyArgs([]))

    expect(rerun.changed).toEqual([])
    expect(rerun.applied).toBe(false)
    expect(await reconcileRows()).toHaveLength(1)

    const advanced = await store.apply(applyArgs([pull({ pullUpdatedAt: '2026-11-18T10:02:00Z' })]))

    expect(advanced.changed).toEqual([])
    expect(await reconcileRows()).toHaveLength(1)
  })
})
