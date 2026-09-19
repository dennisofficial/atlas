import { createHash } from 'node:crypto'
import {
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
const MAX_SESSION_MINUTES = 240

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

const ENV: Record<string, number> = {
  SANDBOX_TTL_MINUTES: TTL_MINUTES,
  SANDBOX_MAX_SESSION_MINUTES: MAX_SESSION_MINUTES,
}
const env = { get: (key: string) => ENV[key] } as unknown as EnvService

const stubGithub = () => ({ findToken: vi.fn(async () => 'gho_user-token') })

const stubClient = () => ({
  getOrCreate: vi.fn(async () => ({
    sessionId: 'ses_created',
    url: 'https://atlas-3000.vercel.run',
    state: ESandboxState.Running,
  })),
  destroy: vi.fn(async () => undefined),
  inspect: vi.fn(async () => ({ state: ESandboxState.Parked })),
  stop: vi.fn(async () => undefined),
  extendTimeout: vi.fn(async () => undefined),
  exposePort: vi.fn(async (args: { name: string; port: number }) => `https://atlas-${args.port}.vercel.run`),
  notifyParked: vi.fn(async () => undefined),
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

  afterEach(async () => {
    await service.whenSettled({ threadId: THREAD })
  })

  it('re-provisions on every attach, returning a fresh token each time', async () => {
    const first = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    expect(first.state).toBe(ESandboxState.Resuming)
    expect(first.url).toBeUndefined()
    expect(fake.cloudSandboxes[0]?.sandboxId).toBe('ses_created')
    expect(client.getOrCreate).toHaveBeenCalledTimes(1)
    expect(client.getOrCreate).toHaveBeenCalledWith({
      name: fake.cloudSandboxes[0]?.name,
      threadId: THREAD,
      token: first.token,
    })

    const second = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    expect(second.state).toBe(ESandboxState.Resuming)
    expect(client.destroy).not.toHaveBeenCalled()
    expect(client.getOrCreate).toHaveBeenCalledTimes(2)
    expect(client.getOrCreate).toHaveBeenNthCalledWith(2, {
      name: fake.cloudSandboxes[0]?.name,
      threadId: THREAD,
      token: second.token,
    })
    expect(second.token).toBeDefined()
    expect(second.token).not.toBe(first.token)
    expect(fake.cloudSandboxes).toHaveLength(1)
  })

  it('resolves promptly with a resuming state and no url while the provision is still in flight', async () => {
    let releaseCreate: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseCreate = resolve
    })
    client.getOrCreate.mockImplementationOnce(async () => {
      await gate
      return {
        sessionId: 'ses_created',
        url: 'https://atlas-3000.vercel.run',
        state: ESandboxState.Running,
      }
    })

    const attached = await service.attach({ userId: USER_A, threadId: THREAD })

    expect(attached.state).toBe(ESandboxState.Resuming)
    expect(attached.url).toBeUndefined()
    expect(attached.token).toBeDefined()

    await vi.waitFor(() => expect(client.getOrCreate).toHaveBeenCalledTimes(1))
    expect(fake.cloudSandboxes[0]?.state).toBe(ESandboxState.Parked)

    releaseCreate?.()
    await service.whenSettled({ threadId: THREAD })

    expect(fake.cloudSandboxes[0]?.state).toBe(ESandboxState.Running)
  })

  it('answers a second attach promptly while its re-provision queues behind the first', async () => {
    let releaseCreate: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseCreate = resolve
    })
    client.getOrCreate.mockImplementationOnce(async () => {
      await gate
      return {
        sessionId: 'ses_created',
        url: 'https://atlas-3000.vercel.run',
        state: ESandboxState.Running,
      }
    })

    const first = await service.attach({ userId: USER_A, threadId: THREAD })
    expect(first.state).toBe(ESandboxState.Resuming)

    await vi.waitFor(() => expect(client.getOrCreate).toHaveBeenCalledTimes(1))

    const second = await service.attach({ userId: USER_A, threadId: THREAD })
    expect(second.state).toBe(ESandboxState.Resuming)
    expect(second.token).not.toBe(first.token)
    expect(client.destroy).not.toHaveBeenCalled()

    releaseCreate?.()
    await service.whenSettled({ threadId: THREAD })

    expect(client.destroy).not.toHaveBeenCalled()
    expect(client.getOrCreate).toHaveBeenCalledTimes(2)
    expect(fake.cloudSandboxes).toHaveLength(1)
  })

  it('serializes two concurrent attaches and re-provisions for the second', async () => {
    const attached = await Promise.all([
      service.attach({ userId: USER_A, threadId: THREAD }),
      service.attach({ userId: USER_A, threadId: THREAD }),
    ])
    await service.whenSettled({ threadId: THREAD })

    expect(fake.cloudSandboxes).toHaveLength(1)
    expect(client.getOrCreate).toHaveBeenCalledTimes(2)
    expect(client.destroy).not.toHaveBeenCalled()
    expect(attached.every((one) => one.token !== undefined)).toBe(true)
  })

  it('never starts the second re-provision until the first finishes provisioning', async () => {
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

    const firstAttached = await service.attach({ userId: USER_A, threadId: THREAD })
    const secondAttached = await service.attach({ userId: USER_A, threadId: THREAD })

    await vi.waitFor(() => expect(client.getOrCreate).toHaveBeenCalledTimes(1))
    expect(client.destroy).not.toHaveBeenCalled()

    releaseFirst?.()
    await service.whenSettled({ threadId: THREAD })

    expect(client.getOrCreate).toHaveBeenCalledTimes(2)
    expect(client.destroy).not.toHaveBeenCalled()
    expect(firstAttached.token).toBeDefined()
    expect(secondAttached.token).toBeDefined()
  })

  it('bumps activity when claiming an existing row, before the re-provision starts', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    fake.cloudSandboxes[0]!.lastActivityAt = '2020-01-01T00:00:00.000Z'

    let releaseCreate: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseCreate = resolve
    })
    client.getOrCreate.mockImplementationOnce(async () => {
      await gate
      return {
        sessionId: 'ses_created',
        url: 'https://atlas-3000.vercel.run',
        state: ESandboxState.Running,
      }
    })

    const attaching = service.attach({ userId: USER_A, threadId: THREAD })
    await vi.waitFor(() => expect(client.getOrCreate).toHaveBeenCalledTimes(2))

    expect(fake.cloudSandboxes[0]?.lastActivityAt).not.toBe('2020-01-01T00:00:00.000Z')

    releaseCreate?.()
    await attaching
    await service.whenSettled({ threadId: THREAD })
  })

  it('returns a fresh token on every attach and stores only its hash', async () => {
    const first = await service.attach({ userId: USER_A, threadId: THREAD })
    const token = first.token
    await service.whenSettled({ threadId: THREAD })

    expect(token).toBeDefined()
    expect(fake.cloudSandboxes[0]?.tokenHash).toBe(
      createHash('sha256')
        .update(token as string)
        .digest('hex'),
    )
    expect(JSON.stringify(fake.cloudSandboxes[0])).not.toContain(token)

    const second = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    expect(second.token).toBeDefined()
    expect(second.token).not.toBe(token)
    expect(fake.cloudSandboxes[0]?.tokenHash).toBe(
      createHash('sha256')
        .update(second.token as string)
        .digest('hex'),
    )
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
    await service.whenSettled({ threadId: THREAD })

    const status = await service.status({ userId: USER_A, threadId: THREAD })

    expect(status.state).toBe(ESandboxState.Parked)
    expect(status.threadId).toBe(THREAD)
  })

  it('answers the stored state without a url when a poll lands mid-provision', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    const name = fake.cloudSandboxes[0]?.name ?? ''
    client.inspect.mockRejectedValueOnce(new SandboxMissingError(name))

    const status = await service.status({ userId: USER_A, threadId: THREAD })

    expect(status.state).toBe(ESandboxState.Running)
    expect(status.url).toBeUndefined()
  })

  it('bumps activity on an authenticated heartbeat and rejects a wrong token', async () => {
    const attached = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    fake.cloudSandboxes[0]!.lastActivityAt = '2026-09-16T00:00:00.000Z'

    await service.verifySessionToken({ threadId: THREAD, token: attached.token as string })
    await service.heartbeat({ threadId: THREAD })

    expect(fake.cloudSandboxes[0]?.lastActivityAt).not.toBe('2026-09-16T00:00:00.000Z')
    await expect(
      service.verifySessionToken({ threadId: THREAD, token: 'not-the-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('extends the session clock by a TTL slice on a heartbeat, so a busy turn outlives it', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    await service.heartbeat({ threadId: THREAD })

    expect(client.extendTimeout).toHaveBeenCalledWith({
      name: fake.cloudSandboxes[0]?.name,
      durationMs: TTL_MINUTES * 60_000,
    })
  })

  it('throttles the extension so a chatty turn cannot burst the provider api', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    await service.heartbeat({ threadId: THREAD })
    await service.heartbeat({ threadId: THREAD })
    await service.heartbeat({ threadId: THREAD })

    expect(client.extendTimeout).toHaveBeenCalledTimes(1)
  })

  it('answers the heartbeat even when the extension is refused', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    client.extendTimeout.mockRejectedValue(new Error('the plan caps the session'))
    fake.cloudSandboxes[0]!.lastActivityAt = '2026-09-16T00:00:00.000Z'

    await expect(service.heartbeat({ threadId: THREAD })).resolves.toBeUndefined()
    await expect(service.heartbeat({ threadId: THREAD })).resolves.toBeUndefined()
    expect(fake.cloudSandboxes[0]?.lastActivityAt).not.toBe('2026-09-16T00:00:00.000Z')
  })

  it('heartbeats without throwing when the row is gone', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    const index = fake.cloudSandboxes.findIndex((row) => row.threadId === THREAD)
    fake.cloudSandboxes.splice(index, 1)

    await expect(service.heartbeat({ threadId: THREAD })).resolves.toBeUndefined()
  })

  it('stops a sandbox and marks it parked', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    const stopped = await service.stop({ userId: USER_A, threadId: THREAD })

    expect(client.stop).toHaveBeenCalledWith({ name: fake.cloudSandboxes[0]?.name })
    expect(stopped.state).toBe(ESandboxState.Parked)
    expect(fake.cloudSandboxes[0]?.state).toBe(ESandboxState.Parked)
  })

  it("exposes a port on the thread's sandbox and hands back the routed url", async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    const exposure = await service.expose({ threadId: THREAD, port: 3001 })

    expect(client.exposePort).toHaveBeenCalledWith({
      name: fake.cloudSandboxes[0]?.name,
      port: 3001,
    })
    expect(exposure).toEqual({
      threadId: THREAD,
      port: 3001,
      url: 'https://atlas-3001.vercel.run',
    })
  })

  it('answers 404 when exposing on a thread with no sandbox or one Vercel has dropped', async () => {
    await expect(service.expose({ threadId: THREAD, port: 3001 })).rejects.toBeInstanceOf(
      NotFoundException,
    )

    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    client.exposePort.mockRejectedValueOnce(new SandboxMissingError('atlas-thread-gone'))
    await expect(service.expose({ threadId: THREAD, port: 3001 })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('notifies the sandbox before stopping it, with the operator-stop reason', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    const order: string[] = []
    client.notifyParked.mockImplementationOnce(async () => {
      order.push('notify')
    })
    client.stop.mockImplementationOnce(async () => {
      order.push('stop')
    })

    await service.stop({ userId: USER_A, threadId: THREAD })

    expect(client.notifyParked).toHaveBeenCalledWith({
      name: fake.cloudSandboxes[0]?.name,
      reason: 'the sandbox was stopped',
    })
    expect(order).toEqual(['notify', 'stop'])
  })

  it('still stops the sandbox when the in-sandbox notify fails', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    client.notifyParked.mockRejectedValueOnce(new Error('the sandbox is wedged'))

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
    expect(client.notifyParked).toHaveBeenCalledWith({
      name: 'atlas-stale',
      reason: 'the sandbox parked after sitting idle',
    })
    expect(fake.cloudSandboxes[0]?.state).toBe(ESandboxState.Parked)
    expect(fake.cloudSandboxes[1]?.state).toBe(ESandboxState.Running)
  })

  it('still parks a stale sandbox the reaper cannot notify', async () => {
    const quiet = new Date(Date.now() - (TTL_MINUTES + 5) * 60_000).toISOString()
    fake.cloudSandboxes.push(
      sandboxRow({ threadId: 'brn_wedged', name: 'atlas-wedged', lastActivityAt: quiet }),
    )
    client.notifyParked.mockRejectedValueOnce(new Error('connection refused'))

    const parked = await service.reap()

    expect(parked).toBe(1)
    expect(client.stop).toHaveBeenCalledWith({ name: 'atlas-wedged' })
    expect(fake.cloudSandboxes[0]?.state).toBe(ESandboxState.Parked)
  })

  it('spares a sandbox a heartbeat refreshed after the sweep began', async () => {
    const quiet = new Date(Date.now() - (TTL_MINUTES + 5) * 60_000).toISOString()
    fake.cloudSandboxes.push(
      sandboxRow({ threadId: 'brn_racy', name: 'atlas-racy', lastActivityAt: quiet }),
    )
    const findUnique = fake.db.cloudSandbox.findUnique.bind(fake.db.cloudSandbox)
    const raced = vi.fn(async (args: unknown) => {
      const row = fake.cloudSandboxes.find((one) => one.threadId === 'brn_racy')
      if (row !== undefined) row.lastActivityAt = new Date().toISOString()
      return findUnique(args as never)
    })
    fake.db.cloudSandbox.findUnique = raced as unknown as typeof findUnique

    try {
      const parked = await service.reap()

      expect(parked).toBe(0)
      expect(client.stop).not.toHaveBeenCalled()
      expect(fake.cloudSandboxes[0]?.state).toBe(ESandboxState.Running)
    } finally {
      fake.db.cloudSandbox.findUnique = findUnique
    }
  })

  it("lets the sandbox token reach its own thread and its sub-agents, nothing else", async () => {
    fake.threads.push(
      threadRow({ id: 'brn_child', spawnerThreadId: THREAD }),
      threadRow({ id: 'brn_elsewhere', spawnerThreadId: 'brn_someone-else' }),
    )

    await expect(
      service.assertThreadInFamily({ sandboxThreadId: THREAD, threadId: THREAD }),
    ).resolves.toBeUndefined()
    await expect(
      service.assertThreadInFamily({ sandboxThreadId: THREAD, threadId: 'brn_child' }),
    ).resolves.toBeUndefined()
    await expect(
      service.assertThreadInFamily({ sandboxThreadId: THREAD, threadId: 'brn_elsewhere' }),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('carries the workspace spec from create through to the sandbox fetch', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD, workspace: SPEC })
    await service.whenSettled({ threadId: THREAD })

    expect(fake.cloudSandboxes[0]?.workspaceCommit).toBe(SPEC.commit)
    await expect(service.workspace({ threadId: THREAD })).resolves.toEqual({
      ...SPEC,
      githubToken: 'gho_user-token',
      skillsBundle: null,
    })
    expect(github.findToken).toHaveBeenCalledWith({ userId: USER_A })
  })

  it('carries the skills bundle through to the workspace fetch and refreshes it on re-attach', async () => {
    const bundle = JSON.stringify({ '.atlas/skills/review/SKILL.md': 'IyByZXZpZXc=' })
    await service.attach({ userId: USER_A, threadId: THREAD, workspace: SPEC, skillsBundle: bundle })
    await service.whenSettled({ threadId: THREAD })

    await expect(service.workspace({ threadId: THREAD })).resolves.toMatchObject({
      skillsBundle: bundle,
    })

    const fresher = JSON.stringify({ '.atlas/skills/review/SKILL.md': 'IyBuZXdlcg==' })
    await service.attach({ userId: USER_A, threadId: THREAD, skillsBundle: fresher })
    await service.whenSettled({ threadId: THREAD })

    const fetched = await service.workspace({ threadId: THREAD })
    expect(fetched.skillsBundle).toBe(fresher)
    expect(fetched.patch).toBe(SPEC.patch)
  })

  it('keeps the stored skills bundle when a re-attach sends none', async () => {
    const bundle = JSON.stringify({ '.atlas/skills/review/SKILL.md': 'IyByZXZpZXc=' })
    await service.attach({ userId: USER_A, threadId: THREAD, workspace: SPEC, skillsBundle: bundle })
    await service.whenSettled({ threadId: THREAD })

    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    await expect(service.workspace({ threadId: THREAD })).resolves.toMatchObject({
      skillsBundle: bundle,
      patch: SPEC.patch,
    })
  })

  it('refuses a skills bundle over the limit before claiming anything', async () => {
    const oversized = 'x'.repeat(4 * 1024 * 1024 + 1)

    await expect(
      service.attach({ userId: USER_A, threadId: THREAD, skillsBundle: oversized }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
    expect(fake.cloudSandboxes).toHaveLength(0)
  })

  it('keeps the stored workspace when a re-attach sends none', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD, workspace: SPEC })
    await service.whenSettled({ threadId: THREAD })

    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    expect(fake.cloudSandboxes).toHaveLength(1)
    expect(fake.cloudSandboxes[0]?.workspaceCommit).toBe(SPEC.commit)
    expect(fake.cloudSandboxes[0]?.workspacePatch).toBe(SPEC.patch)
    await expect(service.workspace({ threadId: THREAD })).resolves.toMatchObject({
      commit: SPEC.commit,
      patch: SPEC.patch,
    })
  })

  it('never writes the git credential onto the sandbox row', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD, workspace: SPEC })
    await service.whenSettled({ threadId: THREAD })
    await service.workspace({ threadId: THREAD })

    expect(JSON.stringify(fake.cloudSandboxes[0])).not.toContain('gho_user-token')
  })

  it('answers a spec without a token when github is not connected', async () => {
    github.findToken.mockResolvedValueOnce(undefined as unknown as string)
    await service.attach({ userId: USER_A, threadId: THREAD, workspace: SPEC })
    await service.whenSettled({ threadId: THREAD })

    await expect(service.workspace({ threadId: THREAD })).resolves.toMatchObject({
      githubToken: null,
    })
  })

  it('treats a session with no repo as a workspace-less one and asks github for nothing', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    await expect(service.workspace({ threadId: THREAD })).resolves.toEqual({
      remoteUrl: null,
      branch: null,
      commit: null,
      patch: '',
      githubToken: null,
      skillsBundle: null,
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

  it('rotates the session token on the same row instead of recreating the sandbox', async () => {
    const first = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    const rowId = fake.cloudSandboxes[0]?.id
    const name = fake.cloudSandboxes[0]?.name

    const attached = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    expect(client.destroy).not.toHaveBeenCalled()
    expect(attached.token).toBeDefined()
    expect(attached.token).not.toBe(first.token)
    expect(client.getOrCreate).toHaveBeenCalledTimes(2)
    expect(fake.cloudSandboxes).toHaveLength(1)
    expect(fake.cloudSandboxes[0]?.id).toBe(rowId)
    expect(fake.cloudSandboxes[0]?.name).toBe(name)
    expect(fake.cloudSandboxes[0]?.tokenHash).toBe(
      createHash('sha256')
        .update(attached.token as string)
        .digest('hex'),
    )
  })

  it('deletes the row when the background provision fails, without rejecting the attach response', async () => {
    client.getOrCreate.mockRejectedValueOnce(new Error('vercel is unhappy'))

    const attached = await service.attach({ userId: USER_A, threadId: THREAD })

    expect(attached.state).toBe(ESandboxState.Resuming)
    expect(attached.token).toBeDefined()

    await service.whenSettled({ threadId: THREAD })
    expect(fake.cloudSandboxes).toHaveLength(0)
    await expect(service.status({ userId: USER_A, threadId: THREAD })).rejects.toThrow(
      'vercel is unhappy',
    )

    const retried = await service.attach({ userId: USER_A, threadId: THREAD })
    expect(retried.token).toBeDefined()
    await service.whenSettled({ threadId: THREAD })
    await expect(service.status({ userId: USER_A, threadId: THREAD })).resolves.toBeDefined()
  })

  it('tolerates an HttpException from the client during background provisioning too', async () => {
    client.getOrCreate.mockRejectedValueOnce(new ServiceUnavailableException('not configured'))

    const attached = await service.attach({ userId: USER_A, threadId: THREAD })
    expect(attached.state).toBe(ESandboxState.Resuming)

    await service.whenSettled({ threadId: THREAD })
    expect(fake.cloudSandboxes).toHaveLength(0)
  })
})
