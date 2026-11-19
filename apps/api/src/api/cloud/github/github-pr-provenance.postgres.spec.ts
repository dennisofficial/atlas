import { EPrSource, EPrState, type PullSample } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import {
  checkRunInputOf,
  commitStatusInputOf,
  recordCommitChecksLocked,
} from './github-commit-checks'
import { foldStateOfRow } from './github-pr-row-fold'
import { storeFixture } from './github-pr-store.fixture'

const REPO = 'compai/app'
const PR = 42

const SAMPLE: PullSample = {
  repoFullName: REPO,
  prNumber: PR,
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: EPrState.Open,
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  headRepoFullName: REPO,
  baseBranch: 'main',
  pullUpdatedAt: '2026-11-18T10:00:00Z',
  closedAt: null,
  mergedAt: null,
}

const pull = (over: Partial<PullSample> = {}) => ({
  kind: 'pull' as const,
  source: EPrSource.Poll,
  observedAt: '2026-11-18T10:00:00Z',
  sample: { ...SAMPLE, ...over },
})

const applyArgs = (
  observations: Parameters<ReturnType<typeof storeFixture>['apply']>[0]['observations'],
) => ({
  repoFullName: REPO,
  prNumber: PR,
  observations,
})

const storedRow = () =>
  db.orm.public.GithubPrState.where({ repoFullName: REPO, prNumber: PR }).first()

const outboxRows = () =>
  db.orm.public.GithubPrOutbox.where({ repoFullName: REPO, prNumber: PR }).all()

describe('GithubPrState provenance', () => {
  useTestDatabase()

  it('keeps a terminal pull closed when a same-second open sample is replayed after storage', async () => {
    const store = storeFixture()
    const closed = pull({
      state: EPrState.Merged,
      pullUpdatedAt: '2026-11-18T10:04:00Z',
      closedAt: '2026-11-18T10:04:00Z',
      mergedAt: '2026-11-18T10:04:00Z',
    })
    await store.apply(applyArgs([closed]))

    const stored = await storedRow()
    expect(stored?.closedAt?.toISOString()).toBe('2026-11-18T10:04:00.000Z')
    expect(stored?.mergedAt?.toISOString()).toBe('2026-11-18T10:04:00.000Z')
    expect(foldStateOfRow(stored ?? null)?.pull?.mergedAt).toBe('2026-11-18T10:04:00.000Z')

    const replayed = await store.apply(
      applyArgs([
        pull({
          pullUpdatedAt: '2026-11-18T10:04:00.000Z',
          closedAt: '2026-11-18T10:04:00.000Z',
          mergedAt: '2026-11-18T10:04:00.000Z',
          state: EPrState.Merged,
        }),
        pull({ pullUpdatedAt: '2026-11-18T10:04:00.000Z' }),
      ]),
    )

    expect(replayed.changed).toEqual([])
    expect(replayed.row?.state).toBe(EPrState.Merged)
  })

  it('breaks a same-instant tie on title after a storage round trip', async () => {
    const store = storeFixture()
    await store.apply(applyArgs([pull({ title: 'first' })]))

    const renamed = await store.apply(applyArgs([pull({ title: 'second' })]))

    expect(renamed.changed).toEqual(['pull'])
    expect(renamed.row?.title).toBe('second')
  })

  it('persists an accepted pull watermark without a visible change', async () => {
    const store = storeFixture()
    await store.apply(applyArgs([pull({ title: 'A' })]))
    const before = await storedRow()

    const watermark = await store.apply(
      applyArgs([pull({ title: 'A', pullUpdatedAt: '2026-11-18T10:02:00Z' })]),
    )

    expect(watermark.changed).toEqual([])
    expect(watermark.applied).toBe(false)
    const after = await storedRow()
    expect(after?.pullUpdatedAt?.toISOString()).toBe('2026-11-18T10:02:00.000Z')
    expect(after?.version).toBe(before?.version)

    const delayed = await store.apply(
      applyArgs([pull({ title: 'B', pullUpdatedAt: '2026-11-18T10:01:00Z' })]),
    )

    expect(delayed.changed).toEqual([])
    expect(delayed.row?.title).toBe('A')
  })

  it('persists an accepted mergeability watermark without a visible change', async () => {
    const store = storeFixture()
    await store.apply(applyArgs([pull()]))
    const sample = {
      ...pull(),
      kind: 'mergeability' as const,
      sample: {
        headSha: 'abc123',
        baseBranch: 'main',
        mergeable: false,
        mergeClean: false,
        observedAt: '2026-11-18T10:00:00.000Z',
      },
    }
    await store.apply(applyArgs([sample]))
    const before = await storedRow()

    const watermark = await store.apply(
      applyArgs([{ ...sample, sample: { ...sample.sample, observedAt: '2026-11-18T10:02:00Z' } }]),
    )

    expect(watermark.changed).toEqual([])
    const after = await storedRow()
    expect(after?.mergeableObservedAt?.toISOString()).toBe('2026-11-18T10:02:00.000Z')
    expect(after?.version).toBe(before?.version)
  })

  it('counts two apps same-named checks separately', async () => {
    const store = storeFixture()
    await store.apply(applyArgs([pull()]))
    await recordCommitChecksLocked({
      repoFullName: REPO,
      headSha: 'abc123',
      checks: [
        checkRunInputOf({
          id: 1,
          name: 'ci',
          status: 'completed',
          conclusion: 'success',
          started_at: '2026-11-18T09:59:00Z',
          completed_at: '2026-11-18T10:00:00Z',
          app: { slug: 'app-a' },
        }),
        checkRunInputOf({
          id: 2,
          name: 'ci',
          status: 'completed',
          conclusion: 'failure',
          started_at: '2026-11-18T09:59:00Z',
          completed_at: '2026-11-18T10:00:00Z',
          app: { slug: 'app-b' },
        }),
      ],
    })

    const applied = await store.apply(applyArgs([]))

    expect(applied.row?.checksPassed).toBe(1)
    expect(applied.row?.checksFailed).toBe(1)
    expect(applied.row?.checksState).toBe('failure')
  })

  const statuses = {
    100: 'pending',
    200: 'success',
  } as const

  const deliverStatus = (id: 100 | 200) =>
    recordCommitChecksLocked({
      repoFullName: REPO,
      headSha: 'abc123',
      checks: [
        commitStatusInputOf({
          id,
          context: 'probe',
          state: statuses[id],
          created_at: '2026-11-18T10:00:00Z',
        }),
      ],
    })

  for (const arrival of [
    [100, 200],
    [200, 100],
  ] as const) {
    it(`orders same-second statuses by their id when ${arrival.join(' arrives before ')}`, async () => {
      const store = storeFixture()
      await store.apply(applyArgs([pull()]))
      for (const id of arrival) await deliverStatus(id)

      const applied = await store.apply(applyArgs([]))

      expect(applied.row?.checksState).toBe('success')
    })
  }

  it('reports an exact replay as unchanged and writes no outbox row', async () => {
    const store = storeFixture()
    const observation = pull()
    await store.apply(applyArgs([observation]))
    await recordCommitChecksLocked({
      repoFullName: REPO,
      headSha: 'abc123',
      checks: [
        checkRunInputOf({
          id: 1,
          name: 'ci',
          status: 'completed',
          conclusion: 'success',
          started_at: '2026-11-18T09:59:00Z',
          completed_at: '2026-11-18T10:00:00Z',
        }),
      ],
    })
    await store.apply(applyArgs([]))
    const before = await outboxRows()

    const replayed = await store.apply(applyArgs([observation]))

    expect(replayed.changed).toEqual([])
    expect(replayed.applied).toBe(false)
    expect(await outboxRows()).toHaveLength(before.length)
  })

  it('leaves a legacy row without pull provenance and lets the first authoritative read initialize it', async () => {
    await db.orm.public.GithubPrState.create({
      repoFullName: REPO,
      prNumber: PR,
      title: 'legacy',
      url: SAMPLE.url,
      state: EPrState.Open,
      headBranch: SAMPLE.headBranch,
      headSha: SAMPLE.headSha,
      headRepoFullName: null,
      baseBranch: '',
      updatedAt: new Date(),
    })
    const legacy = await storedRow()
    expect(foldStateOfRow(legacy ?? null)?.pull?.pullUpdatedAt).toBeNull()

    const store = storeFixture()
    const idle = await store.apply(applyArgs([]))
    expect(idle.applied).toBe(false)
    expect((await storedRow())?.pullUpdatedAt).toBeNull()

    const initialized = await store.apply(applyArgs([pull({ title: 'authoritative' })]))

    expect(initialized.applied).toBe(true)
    expect(initialized.row?.title).toBe('authoritative')
    expect((await storedRow())?.pullUpdatedAt?.toISOString()).toBe('2026-11-18T10:00:00.000Z')
  })
})
