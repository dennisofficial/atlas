import { createHash } from 'node:crypto'
import {
  BadGatewayException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../generated/prisma/client'

vi.mock('../../db', async () => {
  const { fakeSessionDb } = await import('../../../test/fake-session-db.js')
  return { db: fakeSessionDb().db as unknown as PrismaClient }
})

import { applyUpdate, type Where } from '../../../test/fake-db-support.js'
import {
  fakeSessionDb,
  type FakeCloudSandboxRow,
  type FakeThreadRow,
} from '../../../test/fake-session-db.js'
import type { EnvService } from '../../_core/config/env/env.service'
import type { GithubService } from '../github/github.service'
import { SandboxesService } from './sandboxes.service'
import { ESandboxState } from './sandboxes.types'
import { SandboxMissingError, type VercelSandboxClient } from './vercel-sandbox.client'
import { MAX_WORKSPACE_PATCH_BYTES } from './workspace-spec'

const USER_A = 'user-a'
const USER_B = 'user-b'
const THREAD = 'brn_thread_1'
const TTL_MINUTES = 30

const fake = fakeSessionDb()

type CloudSandboxWithUpdateMany = {
  updateMany?: (args: { where: { threadId: string }; data: Where }) => Promise<{ count: number }>
}

const cloudSandboxDb = fake.db.cloudSandbox as unknown as CloudSandboxWithUpdateMany
cloudSandboxDb.updateMany ??= async (args) => {
  const matched = fake.cloudSandboxes.filter((row) => row.threadId === args.where.threadId)
  for (const row of matched) applyUpdate(row as unknown as Record<string, unknown>, args.data)
  return { count: matched.length }
}

const threadRow = (partial: Partial<FakeThreadRow> & { id: string }): FakeThreadRow => ({
  title: null,
  head: 0,
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
  parentThreadId: null,
  forkSeq: null,
  forkMode: null,
  spawnerThreadId: null,
  agentType: null,
  workspace: '/repo',
  repo: '/repo',
  modelRef: null,
  modelEffort: null,
  executionLocation: 'cloud',
  userId: USER_A,
  ...partial,
})

const sandboxRow = (
  partial: Partial<FakeCloudSandboxRow> & { threadId: string },
): FakeCloudSandboxRow => ({
  id: `sbx_${partial.threadId}`,
  userId: USER_A,
  sandboxId: 'ses_old',
  name: `atlas-thread-${partial.threadId}`,
  region: 'iad1',
  state: ESandboxState.Running,
  lastActivityAt: '2026-09-16T00:00:00.000Z',
  tokenHash: 'hash',
  workspaceRemoteUrl: null,
  workspaceBranch: null,
  workspaceCommit: null,
  workspacePatch: null,
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
  ...partial,
})

const PATCH = 'diff --git a/file.ts b/file.ts\n+work in progress\n'

const SPEC = {
  remoteUrl: 'https://github.com/dennisofficial/atlas.git',
  branch: 'dennis/container-cloud',
  commit: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c',
  patch: PATCH,
}

const env = { get: () => TTL_MINUTES } as unknown as EnvService

const stubGithub = () => ({ findToken: vi.fn(async () => 'gho_user-token') })

const stubClient = () => ({
  getOrCreate: vi.fn(async () => ({
    sessionId: 'ses_created',
    url: 'https://atlas-3000.vercel.run',
    state: ESandboxState.Running,
  })),
  resume: vi.fn(async () => ({
    sessionId: 'ses_resumed',
    url: 'https://atlas-3000.vercel.run',
    state: ESandboxState.Running,
  })),
  inspect: vi.fn(async () => ({ state: ESandboxState.Parked })),
  stop: vi.fn(async () => undefined),
})

describe('SandboxesService', () => {
  let client: ReturnType<typeof stubClient>
  let github: ReturnType<typeof stubGithub>
  let service: SandboxesService

  beforeEach(() => {
    fake.reset()
    fake.threads.push(threadRow({ id: THREAD }))
    client = stubClient()
    github = stubGithub()
    service = new SandboxesService(
      client as unknown as VercelSandboxClient,
      env,
      github as unknown as GithubService,
    )
  })

  it('creates the sandbox once and resumes it thereafter', async () => {
    const first = await service.attach({ userId: USER_A, threadId: THREAD })

    expect(first.url).toBe('https://atlas-3000.vercel.run')
    expect(client.getOrCreate).toHaveBeenCalledTimes(1)
    expect(client.getOrCreate).toHaveBeenCalledWith({
      name: fake.cloudSandboxes[0]?.name,
      threadId: THREAD,
      token: first.token,
    })

    const second = await service.attach({ userId: USER_A, threadId: THREAD })

    expect(second.url).toBe('https://atlas-3000.vercel.run')
    expect(client.getOrCreate).toHaveBeenCalledTimes(1)
    expect(client.resume).toHaveBeenCalledTimes(1)
    expect(fake.cloudSandboxes).toHaveLength(1)
    expect(fake.cloudSandboxes[0]?.sandboxId).toBe('ses_resumed')
  })

  it('produces exactly one sandbox for two concurrent attaches', async () => {
    const attached = await Promise.all([
      service.attach({ userId: USER_A, threadId: THREAD }),
      service.attach({ userId: USER_A, threadId: THREAD }),
    ])

    expect(fake.cloudSandboxes).toHaveLength(1)
    expect(client.getOrCreate).toHaveBeenCalledTimes(1)
    expect(attached.filter((one) => one.token !== undefined)).toHaveLength(1)
  })

  it('never starts the second attach until the first finishes provisioning', async () => {
    let releaseFirst: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    client.getOrCreate.mockImplementationOnce(async () => {
      await gate
      return {
        sessionId: 'ses_created',
        url: 'https://atlas-3000.vercel.run',
        state: ESandboxState.Running,
      }
    })

    const first = service.attach({ userId: USER_A, threadId: THREAD })
    const second = service.attach({ userId: USER_A, threadId: THREAD })

    await vi.waitFor(() => expect(client.getOrCreate).toHaveBeenCalledTimes(1))
    expect(client.resume).not.toHaveBeenCalled()

    releaseFirst?.()
    const [firstAttached, secondAttached] = await Promise.all([first, second])

    expect(client.getOrCreate).toHaveBeenCalledTimes(1)
    expect(client.resume).toHaveBeenCalledTimes(1)
    expect(firstAttached.token).toBeDefined()
    expect(secondAttached.token).toBeUndefined()
  })

  it('bumps activity when claiming an existing row, before resume even completes', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    fake.cloudSandboxes[0]!.lastActivityAt = '2020-01-01T00:00:00.000Z'

    let releaseResume: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseResume = resolve
    })
    client.resume.mockImplementationOnce(async () => {
      await gate
      return {
        sessionId: 'ses_resumed',
        url: 'https://atlas-3000.vercel.run',
        state: ESandboxState.Running,
      }
    })

    const attaching = service.attach({ userId: USER_A, threadId: THREAD })
    await vi.waitFor(() => expect(client.resume).toHaveBeenCalledTimes(1))

    expect(fake.cloudSandboxes[0]?.lastActivityAt).not.toBe('2020-01-01T00:00:00.000Z')

    releaseResume?.()
    await attaching
  })

  it('returns the token once and stores only its hash', async () => {
    const first = await service.attach({ userId: USER_A, threadId: THREAD })
    const token = first.token

    expect(token).toBeDefined()
    expect(fake.cloudSandboxes[0]?.tokenHash).toBe(
      createHash('sha256')
        .update(token as string)
        .digest('hex'),
    )
    expect(JSON.stringify(fake.cloudSandboxes[0])).not.toContain(token)

    const second = await service.attach({ userId: USER_A, threadId: THREAD })
    expect(second.token).toBeUndefined()
  })

  it('answers 404 for another user, never 403', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })

    await expect(service.attach({ userId: USER_B, threadId: THREAD })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    await expect(service.status({ userId: USER_B, threadId: THREAD })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    await expect(service.stop({ userId: USER_B, threadId: THREAD })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(client.stop).not.toHaveBeenCalled()
  })

  it('reports the live state for the sidebar', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })

    const status = await service.status({ userId: USER_A, threadId: THREAD })

    expect(status.state).toBe(ESandboxState.Parked)
    expect(status.threadId).toBe(THREAD)
  })

  it('bumps activity on an authenticated heartbeat and rejects a wrong token', async () => {
    const attached = await service.attach({ userId: USER_A, threadId: THREAD })
    fake.cloudSandboxes[0]!.lastActivityAt = '2026-09-16T00:00:00.000Z'

    await service.verifySessionToken({ threadId: THREAD, token: attached.token as string })
    await service.heartbeat({ threadId: THREAD })

    expect(fake.cloudSandboxes[0]?.lastActivityAt).not.toBe('2026-09-16T00:00:00.000Z')
    await expect(
      service.verifySessionToken({ threadId: THREAD, token: 'not-the-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('heartbeats without throwing when the row is gone', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    const index = fake.cloudSandboxes.findIndex((row) => row.threadId === THREAD)
    fake.cloudSandboxes.splice(index, 1)

    await expect(service.heartbeat({ threadId: THREAD })).resolves.toBeUndefined()
  })

  it('stops a sandbox and marks it parked', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })

    const stopped = await service.stop({ userId: USER_A, threadId: THREAD })

    expect(client.stop).toHaveBeenCalledWith({ name: fake.cloudSandboxes[0]?.name })
    expect(stopped.state).toBe(ESandboxState.Parked)
    expect(fake.cloudSandboxes[0]?.state).toBe(ESandboxState.Parked)
  })

  it('reaps only the sandboxes quiet past the TTL', async () => {
    const quiet = new Date(Date.now() - (TTL_MINUTES + 5) * 60_000).toISOString()
    const fresh = new Date(Date.now() - 60_000).toISOString()
    fake.cloudSandboxes.push(
      sandboxRow({ threadId: 'brn_stale', name: 'atlas-stale', lastActivityAt: quiet }),
      sandboxRow({ threadId: 'brn_fresh', name: 'atlas-fresh', lastActivityAt: fresh }),
      sandboxRow({
        threadId: 'brn_parked',
        name: 'atlas-parked',
        lastActivityAt: quiet,
        state: ESandboxState.Parked,
      }),
    )

    const parked = await service.reap()

    expect(parked).toBe(1)
    expect(client.stop).toHaveBeenCalledTimes(1)
    expect(client.stop).toHaveBeenCalledWith({ name: 'atlas-stale' })
    expect(fake.cloudSandboxes[0]?.state).toBe(ESandboxState.Parked)
    expect(fake.cloudSandboxes[1]?.state).toBe(ESandboxState.Running)
  })

  it('carries the workspace spec from create through to the sandbox fetch', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD, workspace: SPEC })

    expect(fake.cloudSandboxes[0]?.workspaceCommit).toBe(SPEC.commit)
    await expect(service.workspace({ threadId: THREAD })).resolves.toEqual({
      ...SPEC,
      githubToken: 'gho_user-token',
    })
    expect(github.findToken).toHaveBeenCalledWith({ userId: USER_A })
  })

  it('never writes the git credential onto the sandbox row', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD, workspace: SPEC })
    await service.workspace({ threadId: THREAD })

    expect(JSON.stringify(fake.cloudSandboxes[0])).not.toContain('gho_user-token')
  })

  it('answers a spec without a token when github is not connected', async () => {
    github.findToken.mockResolvedValueOnce(undefined as unknown as string)
    await service.attach({ userId: USER_A, threadId: THREAD, workspace: SPEC })

    await expect(service.workspace({ threadId: THREAD })).resolves.toMatchObject({
      githubToken: null,
    })
  })

  it('treats a session with no repo as a workspace-less one and asks github for nothing', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })

    await expect(service.workspace({ threadId: THREAD })).resolves.toEqual({
      remoteUrl: null,
      branch: null,
      commit: null,
      patch: '',
      githubToken: null,
    })
    expect(github.findToken).not.toHaveBeenCalled()
  })

  it('refuses a patch over the limit instead of truncating it', async () => {
    const oversized = 'x'.repeat(MAX_WORKSPACE_PATCH_BYTES + 1)

    const attaching = service.attach({
      userId: USER_A,
      threadId: THREAD,
      workspace: { ...SPEC, patch: oversized },
    })

    await expect(attaching).rejects.toBeInstanceOf(PayloadTooLargeException)
    await expect(attaching).rejects.toThrow('over the 5.0MiB limit')
    expect(fake.cloudSandboxes).toHaveLength(0)
    expect(client.getOrCreate).not.toHaveBeenCalled()
  })

  it('re-provisions with a fresh token when the row outlives its sandbox', async () => {
    const first = await service.attach({ userId: USER_A, threadId: THREAD })
    client.resume.mockRejectedValueOnce(
      new SandboxMissingError(fake.cloudSandboxes[0]?.name ?? 'gone'),
    )

    const attached = await service.attach({ userId: USER_A, threadId: THREAD })

    expect(attached.token).toBeDefined()
    expect(attached.token).not.toBe(first.token)
    expect(client.getOrCreate).toHaveBeenCalledTimes(2)
    expect(fake.cloudSandboxes).toHaveLength(1)
    expect(fake.cloudSandboxes[0]?.tokenHash).toBe(
      createHash('sha256')
        .update(attached.token as string)
        .digest('hex'),
    )
  })

  it('keeps the row and propagates when resume fails for another reason', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    client.resume.mockRejectedValueOnce(new Error('vercel is unhappy'))

    await expect(service.attach({ userId: USER_A, threadId: THREAD })).rejects.toThrow(
      'vercel is unhappy',
    )
    expect(fake.cloudSandboxes).toHaveLength(1)
    expect(client.getOrCreate).toHaveBeenCalledTimes(1)
  })

  it('releases the claim when provisioning fails so a retry can mint again', async () => {
    client.getOrCreate.mockRejectedValueOnce(new Error('vercel is unhappy'))

    const attaching = service.attach({ userId: USER_A, threadId: THREAD })
    await expect(attaching).rejects.toBeInstanceOf(BadGatewayException)
    await expect(attaching).rejects.toThrow('vercel is unhappy')
    expect(fake.cloudSandboxes).toHaveLength(0)

    const retried = await service.attach({ userId: USER_A, threadId: THREAD })
    expect(retried.token).toBeDefined()
  })

  it('passes an HttpException from the client straight through', async () => {
    client.getOrCreate.mockRejectedValueOnce(new ServiceUnavailableException('not configured'))

    await expect(service.attach({ userId: USER_A, threadId: THREAD })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    expect(fake.cloudSandboxes).toHaveLength(0)
  })
})
