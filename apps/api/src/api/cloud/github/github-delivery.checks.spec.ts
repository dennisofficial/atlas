import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { prStateRows, seedPrState } from '../../../../test/github-seed'
import { pullRequestCacheFieldsOf } from './github-pull-request-mapping'
import {
  pruneCommitChecks,
  recordCommitChecksLocked,
  commitChecksTally,
  restCommitChecksOf,
} from './github-commit-checks'
import {
  checkRunPayload,
  FILLED_PR_STATE,
  prepareDelivery,
  REST_FIELDS,
  seedHook,
  seedSubscription,
  serviceWith,
} from './github-delivery.fixture'
import { HOOK_EVENTS } from './github-hook-events'

const tallyOf = (headSha: string) =>
  db.transaction((tx) => commitChecksTally({ tx, repoFullName: 'compai/app', headSha }))

const RUNNING = { status: 'in_progress', conclusion: null, completed_at: null }
const STATUS_PAYLOAD = (state: string, updated: string) => ({
  id: 9,
  sha: 'abc123',
  context: 'vercel',
  state,
  created_at: '2026-11-02T04:25:00Z',
  updated_at: updated,
  repository: { full_name: 'compai/app' },
})

const setup = async (readPullRequest = vi.fn(async () => REST_FIELDS)) => {
  const harness = serviceWith({
    tokens: { 'usr-creator': 'ghu_creator' },
    readPullRequest,
  })
  await seedHook({ createdBy: 'usr-creator' })
  await seedSubscription({ userId: 'usr-a', prNumber: 42 })
  await seedPrState({
    ...FILLED_PR_STATE,
    checksRunning: 0,
    checksPassed: 0,
    mergeable: null,
  })
  return { ...harness, readPullRequest }
}

describe('GithubDeliveryService check rows', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('tallies a full CI sequence from webhooks and confirms settlement with one REST read', async () => {
    const readPullRequest = vi.fn(async () => ({
      ...REST_FIELDS,
      checksRunning: 0,
      checksPassed: 5,
      checksIgnored: 1,
    }))
    const { service } = await setup(readPullRequest)
    const run = (id: number, over: object) =>
      service.handle({
        event: 'check_run',
        payload: checkRunPayload({ id, name: `job-${id}`, ...over }),
      })

    for (const id of [1, 2, 3, 4, 5]) await run(id, { ...RUNNING, status: 'queued' })
    await service.handle({
      event: 'status',
      payload: STATUS_PAYLOAD('pending', '2026-11-02T04:25:00Z'),
    })
    for (const id of [1, 2, 3, 4]) await run(id, RUNNING)
    expect((await prStateRows())[0]).toMatchObject({ checksRunning: 6 })

    for (const id of [1, 2, 3, 4]) await run(id, {})
    await run(5, { conclusion: 'skipped' })
    expect(readPullRequest).not.toHaveBeenCalled()
    await service.handle({
      event: 'status',
      payload: STATUS_PAYLOAD('success', '2026-11-02T04:27:00Z'),
    })

    expect(readPullRequest).toHaveBeenCalledTimes(1)
    const tally = await tallyOf('abc123')
    expect(tally).toEqual({ running: 0, passed: 5, failed: 0, ignored: 1 })
    expect((await prStateRows())[0]).toMatchObject({
      checksRunning: tally.running,
      checksPassed: tally.passed,
      checksIgnored: tally.ignored,
    })
  })

  it('keeps a completed run completed when its in_progress delivery arrives late', async () => {
    const { service } = await setup()
    await service.handle({
      event: 'check_run',
      payload: checkRunPayload({ conclusion: 'failure' }),
    })
    await service.handle({
      event: 'check_run',
      payload: checkRunPayload(RUNNING),
    })

    expect(await tallyOf('abc123')).toMatchObject({
      running: 0,
      failed: 1,
    })
  })

  it('counts a re-run once, as the newer outcome', async () => {
    const { service } = await setup()
    await service.handle({
      event: 'check_run',
      payload: checkRunPayload({ id: 1, conclusion: 'failure' }),
    })
    await service.handle({
      event: 'check_run',
      payload: checkRunPayload({
        id: 2,
        started_at: '2026-11-02T04:30:00Z',
        completed_at: '2026-11-02T04:31:00Z',
      }),
    })

    expect(await tallyOf('abc123')).toMatchObject({
      passed: 1,
      failed: 0,
    })
  })

  it('does not change counts for a sha that is not the PR head', async () => {
    const { service, readPullRequest } = await setup()
    await service.handle({
      event: 'check_run',
      payload: checkRunPayload({ ...RUNNING, head_sha: 'old999' }),
    })

    expect((await prStateRows())[0]).toMatchObject({
      checksRunning: 0,
      checksPassed: 0,
    })
    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('handles status events and subscribes the hook to them', async () => {
    const { service } = await setup()

    expect(HOOK_EVENTS).toContain('status')
    expect(
      await service.handle({
        event: 'status',
        payload: STATUS_PAYLOAD('pending', '2026-11-02T04:25:00Z'),
      }),
    ).toEqual({ handled: true })
    expect((await prStateRows())[0]).toMatchObject({ checksRunning: 1 })
  })

  it('makes no GitHub call for a push, a check_suite or a non-head pull_request action', async () => {
    const { service, readPullRequest } = await setup()
    await service.handle({
      event: 'push',
      payload: {
        ref: 'refs/heads/dennis/add-the-thing',
        repository: { full_name: 'compai/app' },
      },
    })
    await service.handle({
      event: 'check_suite',
      payload: {
        check_suite: {
          head_sha: 'abc123',
          head_branch: 'dennis/add-the-thing',
        },
        repository: { full_name: 'compai/app' },
      },
    })
    await service.handle({
      event: 'pull_request',
      payload: {
        action: 'labeled',
        pull_request: {
          number: 42,
          title: 'renamed',
          html_url: 'https://github.com/compai/app/pull/42',
          state: 'open',
          draft: false,
          merged_at: null,
          head: {
            ref: 'dennis/add-the-thing',
            sha: 'abc123',
            repo: { full_name: 'compai/app' },
          },
        },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(readPullRequest).not.toHaveBeenCalled()
    expect((await prStateRows())[0]).toMatchObject({ title: 'renamed' })
  })

  it('seeds rows from REST attempts and the row tally equals the REST-written counts', async () => {
    const checkRuns = [
      {
        id: 1,
        name: 'a',
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-11-02T04:25:00Z',
        completed_at: '2026-11-02T04:26:00Z',
      },
      {
        id: 2,
        name: 'b',
        status: 'completed',
        conclusion: 'skipped',
        started_at: '2026-11-02T04:25:00Z',
        completed_at: '2026-11-02T04:26:00Z',
      },
      {
        id: 3,
        name: 'c',
        status: 'in_progress',
        conclusion: null,
        started_at: '2026-11-02T04:25:00Z',
        completed_at: null,
      },
    ]
    const statuses = [
      {
        context: 'vercel',
        state: 'success',
        created_at: '2026-11-02T04:25:00Z',
        updated_at: '2026-11-02T04:26:00Z',
      },
    ]
    await recordCommitChecksLocked({
      repoFullName: 'compai/app',
      headSha: 'abc123',
      checks: restCommitChecksOf({ checkRuns, statuses }),
    })
    const rest = pullRequestCacheFieldsOf({
      pull: {
        number: 42,
        title: 't',
        html_url: 'u',
        state: 'open',
        draft: false,
        merged_at: null,
        mergeable: true,
        mergeable_state: 'clean',
        head: { ref: 'b', sha: 'abc123', repo: null },
      },
      checkRuns,
      statuses,
    })

    expect(await tallyOf('abc123')).toEqual({
      running: rest.checksRunning,
      passed: rest.checksPassed,
      failed: rest.checksFailed,
      ignored: rest.checksIgnored,
    })
    expect(rest.checksPassed + rest.checksIgnored + rest.checksRunning).toBe(4)
  })

  it('concurrent deliveries for one run id always end completed', async () => {
    const { service } = await setup()
    for (let i = 0; i < 8; i++) {
      const id = 100 + i
      await Promise.all([
        service.handle({ event: 'check_run', payload: checkRunPayload({ id, ...RUNNING }) }),
        service.handle({ event: 'check_run', payload: checkRunPayload({ id }) }),
      ])
      const row = await db.orm.public.GithubCommitCheck.where({
        repoFullName: 'compai/app',
        headSha: 'abc123',
        checkKey: `run:${id}`,
      }).first()
      expect(row?.outcome).toBe('passed')
    }
  })

  it('concurrent deliveries for different runs leave the PR row equal to the full tally', async () => {
    const { service } = await setup()
    for (let round = 0; round < 4; round++) {
      await Promise.all(
        [1, 2, 3, 4, 5, 6].map((n) =>
          service.handle({
            event: 'check_run',
            payload: checkRunPayload({ id: round * 10 + n, name: `job-${round}-${n}`, ...RUNNING }),
          }),
        ),
      )
      const tally = await tallyOf('abc123')
      expect((await prStateRows())[0]).toMatchObject({
        checksRunning: tally.running,
        checksPassed: tally.passed,
        checksFailed: tally.failed,
        checksIgnored: tally.ignored,
      })
      expect(tally.running).toBe((round + 1) * 6)
    }
  })

  it('prunes every stale row across shas and keeps fresh ones', async () => {
    const old = new Date(Date.now() - 30 * 86_400_000)
    for (const sha of ['s1', 's2', 's3']) {
      for (const key of ['run:1', 'run:2']) {
        await db.orm.public.GithubCommitCheck.create({
          repoFullName: 'compai/app',
          headSha: sha,
          checkKey: key,
          name: key,
          startedAt: null,
          outcome: 'passed',
          sourceUpdatedAt: old,
        })
      }
    }
    await db.execute(
      db.raw
        .sql`UPDATE "GithubCommitCheck" SET "updatedAt" = ${old.toISOString()}::timestamptz WHERE "headSha" IN ('s1', 's2', 's3')`
        .affectedCount()
        .build(),
    )
    await db.orm.public.GithubCommitCheck.create({
      repoFullName: 'compai/app',
      headSha: 'fresh',
      checkKey: 'run:1',
      name: 'x',
      startedAt: null,
      outcome: 'passed',
      sourceUpdatedAt: new Date(),
    })

    await pruneCommitChecks({ now: new Date() })

    const left = await db.orm.public.GithubCommitCheck.all()
    expect(left.map((row) => row.headSha)).toEqual(['fresh'])
  })

  it('prunes rows untouched for more than 14 days', async () => {
    const { service } = await setup()
    await service.handle({
      event: 'check_run',
      payload: checkRunPayload(RUNNING),
    })
    await pruneCommitChecks({ now: new Date(Date.now() + 13 * 86_400_000) })
    expect(await db.orm.public.GithubCommitCheck.all()).toHaveLength(1)

    await pruneCommitChecks({ now: new Date(Date.now() + 15 * 86_400_000) })
    expect(await db.orm.public.GithubCommitCheck.all()).toHaveLength(0)
  })
})
