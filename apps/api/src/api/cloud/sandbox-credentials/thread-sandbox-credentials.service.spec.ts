import { ServiceUnavailableException } from '@nestjs/common'
import { EVercelCredentialGap } from '@dltech/atlas-wire/web'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const threads = vi.hoisted(() => ({ rows: new Map<string, { projectId: string | null }>() }))

vi.mock('../../../db', () => ({
  db: {
    thread: {
      findUnique: async (args: { where: { id: string } }) =>
        threads.rows.get(args.where.id) ?? null,
    },
  },
}))

import type { EnvService } from '../../../_core/config/env/env.service'
import { VercelNotConfiguredError } from '../scoped-config/scoped-config.errors'
import type { ScopedConfigService } from '../scoped-config/scoped-config.service'
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

describe('ThreadSandboxCredentialsService', () => {
  beforeEach(() => {
    threads.rows.clear()
  })

  it('answers the workspace credential for a thread that belongs to a project', async () => {
    threads.rows.set('thr-1', { projectId: 'proj-1' })
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
    expect(vercelCredentials).toHaveBeenCalledWith({ projectId: 'proj-1' })
  })

  it('lets a missing workspace credential propagate instead of falling back to the env account', async () => {
    threads.rows.set('thr-1', { projectId: 'proj-1' })
    const { scoped } = scopedReturning(async () => {
      throw new VercelNotConfiguredError(EVercelCredentialGap.WorkspaceCredential)
    })

    await expect(
      new ThreadSandboxCredentialsService(scoped, envWith(LEGACY_ENV)).forThread({
        threadId: 'thr-1',
      }),
    ).rejects.toBeInstanceOf(VercelNotConfiguredError)
  })

  it('falls back to the env credential for a legacy thread with no project', async () => {
    threads.rows.set('thr-1', { projectId: null })
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
    threads.rows.set('thr-1', { projectId: null })
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
