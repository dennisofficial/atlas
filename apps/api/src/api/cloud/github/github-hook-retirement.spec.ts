import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { ensureUsers, repoHookRows, seedRepoHook } from '../../../../test/github-seed'
import { GithubAppInstallationsService } from './github-app-installations.service'
import { GithubHookRetirement } from './github-hook-retirement'
import { GithubHookTeardown } from './github-hook-teardown'
import type { GithubUserReads } from './github-user-reads'
import type { GithubService } from './github.service'

function retirementWith(args: { deleteHook?: () => Promise<'deleted' | 'unauthorized'> }) {
  const deleted: Array<{ repo: string; hookId: number }> = []
  const github = { findToken: async () => 'token' } as unknown as GithubService
  const reads = {
    deleteHook: async (call: { repo: string; hookId: number }) => {
      deleted.push({ repo: call.repo, hookId: call.hookId })
      return (args.deleteHook ?? (async () => 'deleted' as const))()
    },
  } as unknown as GithubUserReads
  const installations = new GithubAppInstallationsService()
  return {
    deleted,
    installations,
    retirement: new GithubHookRetirement(installations, new GithubHookTeardown(github, reads)),
  }
}

const install = (args: { suspendedAt?: Date | null; repos: string[] }) =>
  db.orm.public.GithubAppInstallation.create({
    installationId: 145998843n,
    accountLogin: 'dennisofficial',
    accountType: 'User',
    suspendedAt: args.suspendedAt ?? null,
    repos: args.repos,
  })

describe('GithubHookRetirement', () => {
  useTestDatabase()

  it('tears down an active hook on a covered repo with the stored hook id', async () => {
    await ensureUsers('usr-creator')
    await seedRepoHook({
      repoFullName: 'dennisofficial/atlas',
      hookId: 687717962n,
    })
    await install({ repos: ['dennisofficial/atlas'] })
    const { retirement, deleted } = retirementWith({})

    await retirement.retireCovered()

    expect(deleted).toEqual([{ repo: 'atlas', hookId: 687717962 }])
    expect(await repoHookRows()).toHaveLength(0)
  })

  it('leaves uncovered and suspended-covered repos alone', async () => {
    await seedRepoHook({ repoFullName: 'dennisofficial/atlas', hookId: 1n })
    await seedRepoHook({ repoFullName: 'other/repo', hookId: 2n })
    await install({ repos: ['dennisofficial/atlas'], suspendedAt: new Date() })
    const { retirement, deleted } = retirementWith({})

    await retirement.retireCovered()

    expect(deleted).toEqual([])
    expect(await repoHookRows()).toHaveLength(2)
  })

  it('restores the hook to active when GitHub fails so the next sweep retries', async () => {
    await seedRepoHook({ repoFullName: 'dennisofficial/atlas', hookId: 1n })
    await install({ repos: ['dennisofficial/atlas'] })
    const { retirement } = retirementWith({
      deleteHook: async () => {
        throw new Error('boom')
      },
    })

    await retirement.retireCovered()

    const rows = await repoHookRows()
    expect(rows[0]?.status).toBe('active')
    expect(rows[0]?.sweepLeaseUntil).toBeNull()
  })
})
