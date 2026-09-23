import { BadRequestException, ConflictException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../generated/prisma/client'

vi.mock('../../db', async () => {
  const { fakeFactoryDb } = await import('../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../test/fake-factory-db.js'
import { FactoryConnectionsService } from './connections/connections.service'
import { GithubInstallService } from './github-install.service'
import type { GithubAppService } from './reply/github-app.service'

describe('GithubInstallService', () => {
  const fake = fakeFactoryDb()
  let githubApp: {
    appSlug: ReturnType<typeof vi.fn>
    assertInstallation: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    fake.reset()
    githubApp = {
      appSlug: vi.fn(async () => 'atlas-factory'),
      assertInstallation: vi.fn(async () => undefined),
    }
  })

  function service(): GithubInstallService {
    return new GithubInstallService(
      new FactoryConnectionsService(),
      githubApp as unknown as GithubAppService,
    )
  }

  it('beginInstall builds the install url with the app slug and a uuid state', async () => {
    const url = new URL(await service().beginInstall({ organizationId: 'org_compai' }))

    expect(url.origin + url.pathname).toBe(
      'https://github.com/apps/atlas-factory/installations/new',
    )
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('completeInstall upserts an active github connection for the state organization', async () => {
    const install = service()
    const url = new URL(await install.beginInstall({ organizationId: 'org_compai' }))
    const state = url.searchParams.get('state') as string

    await install.completeInstall({ installationId: '12345678', state })

    expect(fake.connections).toHaveLength(1)
    expect(fake.connections[0]).toMatchObject({
      provider: 'github',
      externalAccountId: '12345678',
      organizationId: 'org_compai',
      status: 'active',
    })
  })

  it('completeInstall rejects an unknown state', async () => {
    await expect(
      service().completeInstall({ installationId: '12345678', state: 'unknown' }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('completeInstall consumes the state so a replay is rejected', async () => {
    const install = service()
    const url = new URL(await install.beginInstall({ organizationId: 'org_compai' }))
    const state = url.searchParams.get('state') as string

    await install.completeInstall({ installationId: '12345678', state })
    await expect(
      install.completeInstall({ installationId: '12345678', state }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('completeInstall verifies the installation exists for this app', async () => {
    const install = service()
    const url = new URL(await install.beginInstall({ organizationId: 'org_compai' }))
    const state = url.searchParams.get('state') as string

    await install.completeInstall({ installationId: '12345678', state })

    expect(githubApp.assertInstallation).toHaveBeenCalledWith({ installationId: '12345678' })
  })

  it('completeInstall refuses an installation another organization already connected', async () => {
    const first = service()
    const firstUrl = new URL(await first.beginInstall({ organizationId: 'org_compai' }))
    await first.completeInstall({
      installationId: '12345678',
      state: firstUrl.searchParams.get('state') as string,
    })

    const second = service()
    const secondUrl = new URL(await second.beginInstall({ organizationId: 'org_other' }))
    const failure = await second
      .completeInstall({
        installationId: '12345678',
        state: secondUrl.searchParams.get('state') as string,
      })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ConflictException)
    expect(githubApp.assertInstallation).toHaveBeenCalledTimes(1)
    expect(fake.connections[0]?.organizationId).toBe('org_compai')
  })

  it('completeInstall rejects a non-numeric installation id', async () => {
    const install = service()
    const url = new URL(await install.beginInstall({ organizationId: 'org_compai' }))
    const state = url.searchParams.get('state') as string

    await expect(
      install.completeInstall({ installationId: '12ab34', state }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(fake.connections).toHaveLength(0)
  })
})
