import { useTestDatabase } from '@dltech/atlas-db/testing'
import { db } from '@dltech/atlas-db'
import { describe, expect, it } from 'bun:test'
import { seedRepoHook } from '../../../../test/github-seed'
import { readRepoCoverage } from './github-repo-coverage'

const seedInstallation = (args: { installationId: bigint; repos: string[]; suspendedAt?: Date }) =>
  db.orm.public.GithubAppInstallation.create({
    installationId: args.installationId,
    accountLogin: 'compai',
    accountType: 'Organization',
    repos: args.repos,
    suspendedAt: args.suspendedAt ?? null,
  })

describe('readRepoCoverage', () => {
  useTestDatabase()

  it('counts app-installed and personally hooked repositories, and nothing else', async () => {
    await seedInstallation({ installationId: 1n, repos: ['CompAI/App', 'compai/other'] })
    await seedInstallation({
      installationId: 2n,
      repos: ['compai/suspended'],
      suspendedAt: new Date(),
    })
    await seedRepoHook({ repoFullName: 'compai/hooked', hookId: 9n })

    const coverage = await readRepoCoverage()

    expect(coverage.covers('compai/app')).toBe(true)
    expect(coverage.covers('COMPAI/APP')).toBe(true)
    expect(coverage.covers('compai/other')).toBe(true)
    expect(coverage.covers('compai/hooked')).toBe(true)
    expect(coverage.covers('compai/suspended')).toBe(false)
    expect(coverage.covers('compai/unknown')).toBe(false)
  })
})
