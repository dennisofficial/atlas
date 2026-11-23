import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import {
  checkRunInputOf,
  readCommitChecks,
  recordCommitChecks,
  type CommitCheckInput,
} from './github-commit-checks'
import { prepareDelivery } from './github-delivery.fixture'

const REPO = 'compai/app'
const HEAD = 'abc123'

const runInput = (id: number): CommitCheckInput =>
  checkRunInputOf({
    id,
    name: `job-${id}`,
    status: 'in_progress',
    conclusion: null,
    started_at: '2026-11-02T04:25:00Z',
    completed_at: null,
  })

describe('commit check reads', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('records against the rows it was handed without reading them again', async () => {
    await db.transaction(async (tx) => {
      const held = await readCommitChecks({ tx, repoFullName: REPO, headSha: HEAD })
      expect(held).toEqual([])
      const model = tx.orm.public.GithubCommitCheck
      const select = spyOn(model, 'select')
      const where = spyOn(model, 'where')
      try {
        const recorded = await recordCommitChecks({
          tx,
          repoFullName: REPO,
          headSha: HEAD,
          checks: [runInput(1)],
          held,
        })
        expect(recorded.map((row) => row.checkKey)).toEqual(['run:1'])
      } finally {
        select.mockRestore()
        where.mockRestore()
      }
    })
  })

  it('hands the written rows on so a second write reuses them', async () => {
    await db.transaction(async (tx) => {
      const recorded = await recordCommitChecks({
        tx,
        repoFullName: REPO,
        headSha: HEAD,
        checks: [runInput(1)],
      })
      const model = tx.orm.public.GithubCommitCheck
      const select = spyOn(model, 'select')
      const where = spyOn(model, 'where')
      try {
        const again = await recordCommitChecks({
          tx,
          repoFullName: REPO,
          headSha: HEAD,
          checks: [runInput(2)],
          held: recorded,
        })
        expect(
          again
            .map((row) => row.checkKey)
            .sort()
            .join(','),
        ).toBe('run:1,run:2')
        expect(select).not.toHaveBeenCalled()
        expect(where).not.toHaveBeenCalled()
      } finally {
        select.mockRestore()
        where.mockRestore()
      }
    })
  })
})
