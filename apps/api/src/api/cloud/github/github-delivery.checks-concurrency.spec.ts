import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { prStateRows } from '../../../../test/github-seed'
import { type CommitCheckInput, restCommitChecksOf } from './github-commit-checks'
import { RUNNING, setupTrackedPr, tallyOf } from './github-delivery.checks.fixture'
import { checkRunPayload, prepareDelivery, REST_FIELDS } from './github-delivery.fixture'

describe('GithubDeliveryService check rows concurrency', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('concurrent deliveries for one run id always end completed', async () => {
    const { service } = await setupTrackedPr()
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
    const { service } = await setupTrackedPr()
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

  it('the confirm write seeds REST attempts under the lock and writes the row tally, not the REST counts', async () => {
    let service!: Awaited<ReturnType<typeof setupTrackedPr>>['service']
    const readPullRequest = vi.fn(async (args: unknown) => {
      await service.handle({
        event: 'check_run',
        payload: checkRunPayload({ id: 2, name: 'late', ...RUNNING }),
      })
      const { collectChecks } = args as {
        collectChecks?: (args: { headSha: string; checks: CommitCheckInput[] }) => void
      }
      collectChecks?.({
        headSha: 'abc123',
        checks: restCommitChecksOf({
          checkRuns: [
            {
              id: 1,
              name: 'build',
              status: 'completed',
              conclusion: 'success',
              started_at: '2026-11-02T04:25:00Z',
              completed_at: '2026-11-02T04:26:00Z',
            },
          ],
          statuses: [],
        }),
      })
      return {
        ...REST_FIELDS,
        checksRunning: 0,
        checksPassed: 1,
        mergeable: true,
        title: 'rest title',
      }
    })
    service = (await setupTrackedPr(readPullRequest)).service

    await service.handle({ event: 'check_run', payload: checkRunPayload({ id: 1 }) })

    expect(await tallyOf('abc123')).toMatchObject({ running: 1, passed: 1 })
    expect((await prStateRows())[0]).toMatchObject({
      checksRunning: 1,
      checksPassed: 1,
      mergeable: true,
      title: 'rest title',
    })
    expect(await db.orm.public.GithubCommitCheck.all()).toHaveLength(2)
  })
})
