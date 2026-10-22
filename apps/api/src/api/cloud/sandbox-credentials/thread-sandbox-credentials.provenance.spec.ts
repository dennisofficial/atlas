import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it, vi } from 'bun:test'
import { seedThreadRow, USER_A } from '../../../../test/session-seed'
import type { EnvService } from '../../../_core/config/env/env.service'
import { prepareSandboxes, THREAD } from '../../platform/sandboxes/sandboxes.fixture'
import type { ScopedConfigService } from '../scoped-config/scoped-config.service'
import {
  fakeScoped,
  launchWith,
  seedBase,
} from '../sandbox-provisioning/sandbox-provisioning.fixture'
import { ThreadSandboxCredentialsService } from './thread-sandbox-credentials.service'

const LEGACY_ENV = {
  VERCEL_TOKEN: 'env-token',
  VERCEL_TEAM_ID: 'env-team',
  VERCEL_PROJECT_ID: 'env-prj',
}

const envWith = (values: Record<string, string>): EnvService =>
  ({ get: (key: string) => values[key] }) as unknown as EnvService

const serviceWith = (scoped: ScopedConfigService) =>
  new ThreadSandboxCredentialsService(scoped, envWith(LEGACY_ENV))

describe('ThreadSandboxCredentialsService provenance', () => {
  useTestDatabase()

  it('keeps a TUI-registered no-project thread on the env credential with workspaceOwned false', async () => {
    const { service } = await prepareSandboxes()
    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      clientToken: 'a'.repeat(64),
      serveUrl: 'https://atlas-3000-abc.vercel.run',
    })
    expect((await db.orm.public.Thread.first({ id: THREAD }))?.executionLocation).toBe('cloud')
    const scoped = fakeScoped()

    const credentials = await serviceWith(scoped).forThread({ threadId: THREAD })

    expect(credentials).toEqual({
      token: 'env-token',
      teamId: 'env-team',
      projectId: 'env-prj',
      workspaceOwned: false,
    })
    expect(scoped.vercelCredentials).not.toHaveBeenCalled()
  })

  it('sends a launched no-project thread through the owner resolver', async () => {
    await seedBase()
    const { service } = launchWith()
    const reply = await service.launch({
      userId: 'usr-1',
      draft: {},
      firstMessage: { sendId: 'snd-1', text: 'hi' },
    })
    const scoped = fakeScoped()

    const credentials = await serviceWith(scoped).forThread({ threadId: reply.thread.id })

    expect(credentials).toMatchObject({ token: 'ws-token', workspaceOwned: true })
    expect(scoped.vercelCredentials).toHaveBeenCalledWith({
      thread: { userId: 'usr-1', organizationId: null },
    })
  })

  it('treats a thread whose launch hit a credential gap as API-provisioned', async () => {
    await seedBase()
    await seedThreadRow({ id: 'thr-gap', userId: 'usr-1' })
    await db.orm.public.SandboxBootStep.create({
      threadId: 'thr-gap',
      step: 'provision',
      state: 'error',
      error: 'no credential',
    })
    const vercelCredentials = vi.fn(async () => ({ token: 't', teamId: 'tm', projectId: 'p' }))
    const scoped = { vercelCredentials } as unknown as ScopedConfigService

    const credentials = await serviceWith(scoped).forThread({ threadId: 'thr-gap' })

    expect(credentials.workspaceOwned).toBe(true)
  })
})
