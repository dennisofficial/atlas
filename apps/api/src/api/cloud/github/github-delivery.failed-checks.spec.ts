import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { prEventRows } from '../../../../test/github-seed'
import { RUNNING, setupTrackedPr } from './github-delivery.checks.fixture'
import { checkRunPayload, prepareDelivery, REST_FIELDS } from './github-delivery.fixture'
import { failedChecksOfRows } from './github-failed-checks'

const failingRun = () => {
  const base = checkRunPayload({ id: 7, name: 'typecheck', conclusion: 'failure' })
  return {
    ...base,
    check_run: {
      ...base.check_run,
      app: { slug: 'github-actions' },
      html_url: 'https://github.com/compai/app/actions/runs/1/job/7',
      output: { title: 'tsc failed', summary: 'src/a.ts:12 TS2322' },
    },
  }
}

const row = (over: Partial<Parameters<typeof failedChecksOfRows>[0][number]>) => ({
  checkKey: 'run:1',
  name: 'lint',
  startedAt: '2026-11-04T10:00:00Z',
  outcome: 'failed',
  appSlug: null,
  detailsUrl: null,
  title: null,
  summary: null,
  sourceUpdatedAt: new Date('2026-11-04T10:00:00Z'),
  ...over,
})

describe('failed checks on a verdict', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('names the failing check with its link, output and run id on the fail-fast verdict', async () => {
    const { service } = await setupTrackedPr()
    await service.handle({
      event: 'check_run',
      payload: checkRunPayload({ id: 1, name: 'build', ...RUNNING }),
    })
    await service.handle({ event: 'check_run', payload: failingRun() })

    const verdicts = (await prEventRows()).filter((event) => event.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]?.payload).toMatchObject({
      verdict: 'failed',
      settled: false,
      failedChecks: [
        {
          name: 'typecheck',
          app: 'github-actions',
          url: 'https://github.com/compai/app/actions/runs/1/job/7',
          checkRunId: '7',
          title: 'tsc failed',
          summary: 'src/a.ts:12 TS2322',
        },
      ],
    })
  })

  it('names the failing check on the settled verdict', async () => {
    const { service } = await setupTrackedPr(
      vi.fn(async () => ({ ...REST_FIELDS, checksRunning: 0, checksPassed: 0, checksFailed: 1 })),
    )
    await service.handle({ event: 'check_run', payload: failingRun() })

    const settled = (await prEventRows()).filter(
      (event) => event.kind === 'verdict' && (event.payload as { settled?: boolean }).settled,
    )
    expect(settled).toHaveLength(1)
    expect(settled[0]?.payload).toMatchObject({
      verdict: 'failed',
      failedChecks: [{ name: 'typecheck', checkRunId: '7' }],
    })
  })
})

describe('failedChecksOfRows', () => {
  it('skips a failure that a newer attempt of the same check superseded', () => {
    const checks = failedChecksOfRows([
      row({ checkKey: 'run:1', startedAt: '2026-11-04T10:00:00Z' }),
      row({ checkKey: 'run:2', startedAt: '2026-11-04T10:05:00Z', outcome: 'passed' }),
    ])

    expect(checks).toEqual([])
  })

  it('ignores suites and names a status context by its context', () => {
    const checks = failedChecksOfRows([
      row({ checkKey: 'suite:3', name: 'suite:3' }),
      row({
        checkKey: 'status:vercel',
        name: 'vercel',
        startedAt: null,
        detailsUrl: 'https://vercel.com/x',
        summary: 'Build failed',
      }),
    ])

    expect(checks).toEqual([
      { name: 'vercel', url: 'https://vercel.com/x', summary: 'Build failed' },
    ])
  })

  it('caps the list at ten checks in name order', () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      row({ checkKey: `run:${index}`, name: `job-${String(index).padStart(2, '0')}` }),
    )

    const checks = failedChecksOfRows(rows)
    expect(checks).toHaveLength(10)
    expect(checks[0]?.name).toBe('job-00')
  })
})
