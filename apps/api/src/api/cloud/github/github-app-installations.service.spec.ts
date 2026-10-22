import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { PrismaClient } from '../../../generated/prisma/client'

mock.module('../../../db', () => ({ db: fakeGithubDb().db as unknown as PrismaClient }))

import { fakeGithubDb } from '../../../../test/fake-github-db'
import { GithubAppInstallationsService } from './github-app-installations.service'
import type { GithubAppInstallationWebhookPayload } from './github-webhook.types'

const fake = fakeGithubDb()
const service = new GithubAppInstallationsService()

function installationPayload(overrides: {
  action?: string
  id?: number
  suspended?: boolean
  repos?: string[]
}): GithubAppInstallationWebhookPayload {
  return {
    action: overrides.action ?? 'created',
    installation: {
      id: overrides.id ?? 1001,
      account: { login: 'trycompai', type: 'Organization' },
      suspended_at: overrides.suspended === true ? '2026-10-14T00:00:00Z' : null,
    },
    repositories: (overrides.repos ?? ['trycompai/comp-v2']).map((full_name) => ({ full_name })),
  }
}

describe('GithubAppInstallationsService', () => {
  beforeEach(() => fake.reset())

  it('covers a repo after a created installation and stops covering it on delete', async () => {
    await service.applyInstallation(installationPayload({}))
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v2' })).toBe(true)
    expect(await service.coversRepo({ repoFullName: 'trycompai/other' })).toBe(false)

    await service.applyInstallation(installationPayload({ action: 'deleted' }))
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v2' })).toBe(false)
  })

  it('a suspended installation covers nothing until unsuspended', async () => {
    await service.applyInstallation(installationPayload({ suspended: true }))
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v2' })).toBe(false)

    await service.applyInstallation(installationPayload({ action: 'unsuspend', suspended: false }))
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v2' })).toBe(true)
  })

  it('installation_repositories adds and removes repos from the held set', async () => {
    await service.applyInstallation(installationPayload({ repos: ['trycompai/comp-v2'] }))
    await service.applyRepositories({
      action: 'added',
      installation: {
        id: 1001,
        account: { login: 'trycompai', type: 'Organization' },
        suspended_at: null,
      },
      repositories_added: [{ full_name: 'trycompai/comp-v3' }],
    })
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v3' })).toBe(true)

    await service.applyRepositories({
      action: 'removed',
      installation: {
        id: 1001,
        account: { login: 'trycompai', type: 'Organization' },
        suspended_at: null,
      },
      repositories_removed: [{ full_name: 'trycompai/comp-v2' }],
    })
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v2' })).toBe(false)
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v3' })).toBe(true)
  })

  it('ignores an installation event that carries no repositories list', async () => {
    const { repositories: _omitted, ...withoutRepos } = installationPayload({})
    await service.applyInstallation(withoutRepos)
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v2' })).toBe(false)
  })
})
