import { ServiceUnavailableException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { seedThread, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'

import type { ScopedConfigService } from '../scoped-config/scoped-config.service'
import { NOT_CONFIGURED_MESSAGE } from '../scoped-config/scoped-config.service'
import { seedProject, seedSessionUsers } from '../../../test/web-settings.fake-db'
import { ScopedSandboxCredentialsService } from './scoped-sandbox-credentials.service'

const scopedReturning = (
  outcome: () => Promise<{ token: string; teamId: string; projectId: string }>,
) => {
  const vercelCredentials = vi.fn(outcome)
  return { scoped: { vercelCredentials } as unknown as ScopedConfigService, vercelCredentials }
}

const platform = () =>
  scopedReturning(async () => ({
    token: 'plat-token',
    teamId: 'plat-team',
    projectId: 'plat-prj',
  }))

const seedThreadWithProject = async (projectId: string | null): Promise<void> => {
  if (projectId !== null) await seedProject({ id: projectId, ownerUserId: 'user-a' })
  await seedThread({
    db,
    id: 'thr-1',
    userId: 'user-a',
    ...(projectId === null ? {} : { projectId }),
  })
}

describe('ScopedSandboxCredentialsService', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedSessionUsers()
  })

  it('resolves any thread to the platform account and its owner', async () => {
    await seedThreadWithProject('proj-1')
    const { scoped, vercelCredentials } = platform()

    const credentials = await new ScopedSandboxCredentialsService(scoped).forThread({
      threadId: 'thr-1',
    })

    expect(credentials).toEqual({
      token: 'plat-token',
      teamId: 'plat-team',
      projectId: 'plat-prj',
      ownerCredential: true,
      userId: 'user-a',
    })
    expect(vercelCredentials).toHaveBeenCalledTimes(1)
  })

  it('resolves a no-project thread the same way', async () => {
    await seedThreadWithProject(null)
    const { scoped } = platform()

    const credentials = await new ScopedSandboxCredentialsService(scoped).forThread({
      threadId: 'thr-1',
    })

    expect(credentials).toMatchObject({ token: 'plat-token', userId: 'user-a' })
  })

  it('answers status 503 when the deployment carries no platform account', async () => {
    await seedThreadWithProject('proj-1')
    const failure = new ServiceUnavailableException(NOT_CONFIGURED_MESSAGE)
    const { scoped } = scopedReturning(async () => Promise.reject(failure))
    const service = new ScopedSandboxCredentialsService(scoped)

    await expect(service.forThread({ threadId: 'thr-1' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    await expect(service.forThread({ threadId: 'thr-1' })).rejects.toThrow(NOT_CONFIGURED_MESSAGE)
  })

  it('answers the platform account for a thread it cannot find, with no owner', async () => {
    const { scoped } = platform()

    const credentials = await new ScopedSandboxCredentialsService(scoped).forThread({
      threadId: 'missing',
    })

    expect(credentials).toMatchObject({ token: 'plat-token', ownerCredential: true })
    expect(credentials.userId).toBeUndefined()
  })

  it('keeps a sandbox in the project it was created in after the platform project changed', async () => {
    await seedThreadWithProject('proj-1')
    const at = new Date('2026-11-09T10:00:00Z')
    await db.orm.public.CloudSandbox.create({
      id: 'sbx-1',
      sessionId: 'ses_thr-1',
      userId: 'user-a',
      sandboxId: '',
      name: 'atlas-thread-1',
      region: 'iad1',
      vercelProjectId: 'prj-sandboxes-old',
      state: 'running',
      lastActivityAt: at,
      tokenHash: 'hash',
      createdAt: at,
      updatedAt: at,
    })
    const { scoped } = platform()

    const credentials = await new ScopedSandboxCredentialsService(scoped).forThread({
      threadId: 'thr-1',
    })

    expect(credentials.projectId).toBe('prj-sandboxes-old')
  })

  it('resolves a build with no thread through the platform account', async () => {
    const { scoped } = platform()

    const credentials = await new ScopedSandboxCredentialsService(scoped).forUser({
      userId: 'user-a',
    })

    expect(credentials).toEqual({
      token: 'plat-token',
      teamId: 'plat-team',
      projectId: 'plat-prj',
      userId: 'user-a',
    })
  })
})
