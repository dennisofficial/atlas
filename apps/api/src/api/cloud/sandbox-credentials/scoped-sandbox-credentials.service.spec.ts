import { ServiceUnavailableException } from '@nestjs/common'
import { EVercelCredentialGap } from '@dltech/atlas-wire/web'
import { db } from '@dltech/atlas-db'
import { seedThread, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'

import type { EnvService } from '../../../_core/config/env/env.service'
import { VercelNotConfiguredError } from '../scoped-config/scoped-config.errors'
import type { ScopedConfigService } from '../scoped-config/scoped-config.service'
import { seedProject, seedSessionUsers } from '../../../test/web-settings.fake-db'
import { ScopedSandboxCredentialsService } from './scoped-sandbox-credentials.service'

const envWith = (values: Record<string, string>): EnvService =>
  ({ get: (key: string) => values[key] }) as unknown as EnvService

const LEGACY_ENV = {
  VERCEL_TOKEN: 'env-token',
  VERCEL_TEAM_ID: 'env-team',
  VERCEL_PROJECT_ID: 'env-prj',
}

const scopedReturning = (
  outcome: () => Promise<{ token: string; teamId: string; projectId: string }>,
) => {
  const vercelCredentials = vi.fn(outcome)
  return { scoped: { vercelCredentials } as unknown as ScopedConfigService, vercelCredentials }
}

const seedThreadWithProject = async (
  projectId: string | null,
  extra: { apiProvisioned?: boolean } = {},
): Promise<void> => {
  if (projectId !== null) await seedProject({ id: projectId, ownerUserId: 'user-a' })
  await seedThread({
    db,
    id: 'thr-1',
    userId: 'user-a',
    ...(projectId === null ? {} : { projectId }),
  })
  if (extra.apiProvisioned === true) {
    await db.orm.public.SandboxBootStep.create({
      sessionId: 'ses_thr-1',
      step: 'provision',
      state: 'running',
    })
  }
}

describe('ScopedSandboxCredentialsService', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedSessionUsers()
  })

  it('resolves a personal-project thread through its creator', async () => {
    await seedThreadWithProject('proj-1')
    const { scoped, vercelCredentials } = scopedReturning(async () => ({
      token: 'user-token',
      teamId: 'user-team',
      projectId: 'user-prj',
    }))

    const credentials = await new ScopedSandboxCredentialsService(
      scoped,
      envWith(LEGACY_ENV),
    ).forThread({ threadId: 'thr-1' })

    expect(credentials).toMatchObject({
      token: 'user-token',
      ownerCredential: true,
      userId: 'user-a',
    })
    expect(vercelCredentials).toHaveBeenCalledWith({ thread: { userId: 'user-a' } })
  })

  it('sends an API-provisioned no-project thread to the owner resolver, never the env account', async () => {
    await seedThreadWithProject(null, { apiProvisioned: true })
    const { scoped, vercelCredentials } = scopedReturning(async () => ({
      token: 'user-token',
      teamId: 'user-team',
      projectId: 'user-prj',
    }))

    const credentials = await new ScopedSandboxCredentialsService(
      scoped,
      envWith(LEGACY_ENV),
    ).forThread({ threadId: 'thr-1' })

    expect(credentials).toMatchObject({ token: 'user-token', ownerCredential: true })
    expect(vercelCredentials).toHaveBeenCalledWith({ thread: { userId: 'user-a' } })
  })

  it('lets a missing owner credential on an API-provisioned no-project thread propagate', async () => {
    await seedThreadWithProject(null, { apiProvisioned: true })
    const { scoped } = scopedReturning(async () => {
      throw new VercelNotConfiguredError(EVercelCredentialGap.UserCredential)
    })

    await expect(
      new ScopedSandboxCredentialsService(scoped, envWith(LEGACY_ENV)).forThread({
        threadId: 'thr-1',
      }),
    ).rejects.toMatchObject({ gap: EVercelCredentialGap.UserCredential })
  })

  it('lets a missing owner credential propagate instead of falling back to the env account', async () => {
    await seedThreadWithProject('proj-1')
    const { scoped } = scopedReturning(async () => {
      throw new VercelNotConfiguredError(EVercelCredentialGap.UserCredential)
    })

    await expect(
      new ScopedSandboxCredentialsService(scoped, envWith(LEGACY_ENV)).forThread({
        threadId: 'thr-1',
      }),
    ).rejects.toBeInstanceOf(VercelNotConfiguredError)
  })

  it('falls back to the env credential for a legacy local thread with no project', async () => {
    await seedThreadWithProject(null)
    const { scoped, vercelCredentials } = scopedReturning(async () => {
      throw new Error('must not be called')
    })

    const credentials = await new ScopedSandboxCredentialsService(
      scoped,
      envWith(LEGACY_ENV),
    ).forThread({ threadId: 'thr-1' })

    expect(credentials).toEqual({
      token: 'env-token',
      teamId: 'env-team',
      projectId: 'env-prj',
      ownerCredential: false,
      userId: undefined,
    })
    expect(vercelCredentials).not.toHaveBeenCalled()
  })

  it('treats an unknown thread as legacy', async () => {
    const { scoped } = scopedReturning(async () => {
      throw new Error('must not be called')
    })

    const credentials = await new ScopedSandboxCredentialsService(
      scoped,
      envWith(LEGACY_ENV),
    ).forThread({ threadId: 'missing' })

    expect(credentials.ownerCredential).toBe(false)
    expect(credentials.userId).toBeUndefined()
  })

  it('keeps a sandbox in the project it was created in after the credential moved', async () => {
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
    const { scoped } = scopedReturning(async () => ({
      token: 'user-token',
      teamId: 'user-team',
      projectId: 'prj-sandboxes-new',
    }))

    const credentials = await new ScopedSandboxCredentialsService(
      scoped,
      envWith(LEGACY_ENV),
    ).forThread({ threadId: 'thr-1' })

    expect(credentials.projectId).toBe('prj-sandboxes-old')
  })

  it('answers 503 when a legacy thread finds no env credential', async () => {
    await seedThreadWithProject(null)
    const { scoped } = scopedReturning(async () => {
      throw new Error('must not be called')
    })
    const service = new ScopedSandboxCredentialsService(
      scoped,
      envWith({ VERCEL_TOKEN: 'env-token' }),
    )

    await expect(service.forThread({ threadId: 'thr-1' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    await expect(service.forThread({ threadId: 'thr-1' })).rejects.toThrow(
      'Atlas Cloud sandboxes are not configured on this deployment',
    )
  })

  it('resolves a build with no thread through the publisher’s own connection', async () => {
    const { scoped, vercelCredentials } = scopedReturning(async () => ({
      token: 'user-token',
      teamId: 'user-team',
      projectId: 'user-prj',
    }))

    const credentials = await new ScopedSandboxCredentialsService(
      scoped,
      envWith(LEGACY_ENV),
    ).forUser({ userId: 'user-a' })

    expect(credentials).toEqual({
      token: 'user-token',
      teamId: 'user-team',
      projectId: 'user-prj',
      userId: 'user-a',
    })
    expect(vercelCredentials).toHaveBeenCalledWith({ thread: { userId: 'user-a' } })
  })

  it('never answers a user-scoped build with the deployment env account', async () => {
    const { scoped } = scopedReturning(async () => {
      throw new VercelNotConfiguredError(EVercelCredentialGap.UserCredential)
    })

    const credentials = new ScopedSandboxCredentialsService(scoped, envWith(LEGACY_ENV)).forUser({
      userId: 'user-a',
    })

    await expect(credentials).rejects.toBeInstanceOf(VercelNotConfiguredError)
    await expect(credentials).rejects.toMatchObject({
      gap: EVercelCredentialGap.UserCredential,
    })
  })
})
