import { useTestDatabase } from '@dltech/atlas-db/testing'
import { db } from '@dltech/atlas-db'
import { describe, expect, it } from 'bun:test'
import { seedRepoHook } from '../../../../test/github-seed'
import {
  ERepoTracking,
  readRepoCoverage,
  readRepoTracking,
  trackingOf,
} from './github-repo-coverage'

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

  it('names which transport covers a repository, and falls back to polling', async () => {
    await seedInstallation({ installationId: 1n, repos: ['CompAI/App'] })
    await seedRepoHook({ repoFullName: 'compai/hooked', hookId: 9n })

    const tracking = await readRepoTracking()

    expect(tracking.trackingOf('compai/app')).toBe(ERepoTracking.App)
    expect(tracking.trackingOf('compai/hooked')).toBe(ERepoTracking.User)
    expect(tracking.trackingOf('compai/unknown')).toBe(ERepoTracking.Polled)
  })
})

describe('trackingOf', () => {
  const sources = { installationRepos: ['CompAI/App'], hookedRepos: ['compai/hooked'] }

  it('prefers an app installation over a personal hook on the same repository', () => {
    const tracking = trackingOf({
      installationRepos: ['compai/both'],
      hookedRepos: ['CompAI/Both'],
    })

    expect(tracking.trackingOf('compai/both')).toBe(ERepoTracking.App)
  })

  it('reads a hooked repository without an installation as a user webhook', () => {
    expect(trackingOf(sources).trackingOf('compai/hooked')).toBe(ERepoTracking.User)
  })

  it('reads a repository neither source names as polled', () => {
    expect(trackingOf(sources).trackingOf('compai/elsewhere')).toBe(ERepoTracking.Polled)
  })

  it('matches repositories case-insensitively', () => {
    const tracking = trackingOf(sources)

    expect(tracking.trackingOf('COMPAI/app')).toBe(ERepoTracking.App)
    expect(tracking.trackingOf('CompAI/Hooked')).toBe(ERepoTracking.User)
  })
})
