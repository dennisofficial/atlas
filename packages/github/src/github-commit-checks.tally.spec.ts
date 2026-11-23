import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { commitChecksTally } from './github-commit-checks'

const tallyOf = (headSha: string) =>
  db.transaction((tx) => commitChecksTally({ tx, repoFullName: 'compai/app', headSha }))

const seedRow = (args: {
  headSha: string
  checkKey: string
  name?: string
  outcome: string
  appSlug?: string
}) =>
  db.orm.public.GithubCommitCheck.create({
    repoFullName: 'compai/app',
    headSha: args.headSha,
    checkKey: args.checkKey,
    name: args.name ?? args.checkKey,
    outcome: args.outcome,
    sourceUpdatedAt: new Date('2026-11-13T00:00:00Z'),
    appSlug: args.appSlug ?? null,
  })

describe('commitChecksTally', () => {
  useTestDatabase()

  it('does not count a pending suite row as a running check', async () => {
    for (let id = 0; id < 17; id++) {
      await seedRow({ headSha: 'sha1', checkKey: `run:${id}`, outcome: 'passed', appSlug: 'gh' })
    }
    for (const n of [1, 2, 3]) {
      await seedRow({
        headSha: `older${n}`,
        checkKey: `run:${900 + n}`,
        outcome: 'passed',
        appSlug: 'gh',
      })
    }
    await seedRow({ headSha: 'sha1', checkKey: 'suite:1', outcome: 'running', appSlug: 'gh' })

    expect(await tallyOf('sha1')).toEqual({ running: 0, passed: 17, failed: 0, ignored: 0 })
  })

  it('counts two apps same-named checks separately', async () => {
    await seedRow({
      headSha: 'sha1',
      checkKey: 'run:1',
      name: 'ci',
      outcome: 'failed',
      appSlug: 'a',
    })
    await seedRow({
      headSha: 'sha1',
      checkKey: 'run:2',
      name: 'ci',
      outcome: 'passed',
      appSlug: 'b',
    })
    await seedRow({
      headSha: 'sha1',
      checkKey: 'run:3',
      name: 'ci',
      outcome: 'running',
      appSlug: 'c',
    })

    expect(await tallyOf('sha1')).toEqual({ running: 1, passed: 1, failed: 1, ignored: 0 })
  })

  it('keeps a run that is still going', async () => {
    await seedRow({ headSha: 'sha1', checkKey: 'run:1', outcome: 'running', appSlug: 'gh' })
    await seedRow({ headSha: 'sha1', checkKey: 'suite:1', outcome: 'completed', appSlug: 'gh' })

    expect(await tallyOf('sha1')).toEqual({ running: 1, passed: 0, failed: 0, ignored: 0 })
  })
})
