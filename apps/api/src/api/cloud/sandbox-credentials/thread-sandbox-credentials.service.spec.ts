import { ServiceUnavailableException } from '@nestjs/common'
import { EVercelCredentialGap } from '@dltech/atlas-wire/web'
import { db } from '@dltech/atlas-db'
import { seedThread, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'

import type { EnvService } from '../../../_core/config/env/env.service'
import { VercelNotConfiguredError } from '../scoped-config/scoped-config.errors'
import type { ScopedConfigService } from '../scoped-config/scoped-config.service'
import { seedProject, seedSessionUsers, seedWorkspace } from '../web-settings.fake-db'
import { ThreadSandboxCredentialsService } from './thread-sandbox-credentials.service'

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
  extra: { organizationId?: string; apiProvisioned?: boolean } = {},
): Promise<void> => {
  if (projectId !== null) await seedProject({ id: projectId, ownerUserId: 'user-a' })
  await seedThread({
    db,
    id: 'thr-1',
    userId: 'user-a',
    ...(projectId === null ? {} : { projectId }),
  })
  if (extra.organizationId !== undefined) {
    await db.orm.public.Thread.where({ id: 'thr-1' }).update({
      organizationId: extra.organizationId,
    })
  }
  if (extra.apiProvisioned === true) {
    await db.orm.public.SandboxBootStep.create({
      threadId: 'thr-1',
      step: 'provision',
      state: 'running',
    })
  }
}

describe('ThreadSandboxCredentialsService', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedSessionUsers()
  })

  it('resolves a workspace-project thread through its stored owner organization', async () => {
    await seedWorkspace({ id: 'org-1', members: [{ userId: 'user-a', role: 'owner' }] })
    await seedThreadWithProject('proj-1', { organizationId: 'org-1' })
    const { scoped, vercelCredentials } = scopedReturning(async () => ({
      token: 'ws-token',
      teamId: 'ws-team',
      projectId: 'ws-prj',
    }))

    const credentials = await new ThreadSandboxCredentialsService(
      scoped,
      envWith(LEGACY_ENV),
    ).forThread({
      threadId: 'thr-1',
    })

    expect(credentials).toEqual({
      token: 'ws-token',
      teamId: 'ws-team',
      projectId: 'ws-prj',
      workspaceOwned: true,
    })
    expect(vercelCredentials).toHaveBeenCalledWith({
      thread: { userId: 'user-a', organizationId: 'org-1' },
    })
  })

  it('resolves a personal-project thread through its creator', async () => {
    await seedThreadWithProject('proj-1')
    const { scoped, vercelCredentials } = scopedReturning(async () => ({
      token: 'user-token',
      teamId: 'user-team',
      projectId: 'user-prj',
    }))

    const credentials = await new ThreadSandboxCredentialsService(
      scoped,
      envWith(LEGACY_ENV),
    ).forThread({ threadId: 'thr-1' })

    expect(credentials).toMatchObject({ token: 'user-token', workspaceOwned: true })
    expect(vercelCredentials).toHaveBeenCalledWith({
      thread: { userId: 'user-a', organizationId: null },
    })
  })

  it('sends an API-provisioned no-project thread to the owner resolver, never the env account', async () => {
    await seedThreadWithProject(null, { apiProvisioned: true })
    const { scoped, vercelCredentials } = scopedReturning(async () => ({
      token: 'user-token',
      teamId: 'user-team',
      projectId: 'user-prj',
    }))

    const credentials = await new ThreadSandboxCredentialsService(
      scoped,
      envWith(LEGACY_ENV),
    ).forThread({ threadId: 'thr-1' })

    expect(credentials).toMatchObject({ token: 'user-token', workspaceOwned: true })
    expect(vercelCredentials).toHaveBeenCalledWith({
      thread: { userId: 'user-a', organizationId: null },
    })
  })

  it('lets a missing owner credential on an API-provisioned no-project thread propagate', async () => {
    await seedThreadWithProject(null, { apiProvisioned: true })
    const { scoped } = scopedReturning(async () => {
      throw new VercelNotConfiguredError(EVercelCredentialGap.UserCredential)
    })

    await expect(
      new ThreadSandboxCredentialsService(scoped, envWith(LEGACY_ENV)).forThread({
        threadId: 'thr-1',
      }),
    ).rejects.toMatchObject({ gap: EVercelCredentialGap.UserCredential })
  })

  it('lets a missing workspace credential propagate instead of falling back to the env account', async () => {
    await seedThreadWithProject('proj-1')
    const { scoped } = scopedReturning(async () => {
      throw new VercelNotConfiguredError(EVercelCredentialGap.WorkspaceCredential)
    })

    await expect(
      new ThreadSandboxCredentialsService(scoped, envWith(LEGACY_ENV)).forThread({
        threadId: 'thr-1',
      }),
    ).rejects.toBeInstanceOf(VercelNotConfiguredError)
  })

  it('falls back to the env credential for a legacy local thread with no project', async () => {
    await seedThreadWithProject(null)
    const { scoped, vercelCredentials } = scopedReturning(async () => {
      throw new Error('must not be called')
    })

    const credentials = await new ThreadSandboxCredentialsService(
      scoped,
      envWith(LEGACY_ENV),
    ).forThread({
      threadId: 'thr-1',
    })

    expect(credentials).toEqual({
      token: 'env-token',
      teamId: 'env-team',
      projectId: 'env-prj',
      workspaceOwned: false,
    })
    expect(vercelCredentials).not.toHaveBeenCalled()
  })

  it('treats an unknown thread as legacy', async () => {
    const { scoped } = scopedReturning(async () => {
      throw new Error('must not be called')
    })

    const credentials = await new ThreadSandboxCredentialsService(
      scoped,
      envWith(LEGACY_ENV),
    ).forThread({
      threadId: 'missing',
    })

    expect(credentials.workspaceOwned).toBe(false)
  })

  it('answers 503 when a legacy thread finds no env credential', async () => {
    await seedThreadWithProject(null)
    const { scoped } = scopedReturning(async () => {
      throw new Error('must not be called')
    })
    const service = new ThreadSandboxCredentialsService(
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
})
