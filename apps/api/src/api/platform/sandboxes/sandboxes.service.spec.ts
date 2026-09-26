import { createHash } from 'node:crypto'
import {
  HttpException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, type PrismaClient } from '../../../generated/prisma/client'
import type { ContextArchiveStore } from '../../cloud/context-archive/context-archive.store'

vi.mock('../../../db', async () => {
  const { fakeSessionDb } = await import('../../../../test/fake-session-db.js')
  return { db: fakeSessionDb().db as unknown as PrismaClient }
})

import {
  fakeSessionDb,
  type FakeCloudSandboxRow,
  type FakeThreadRow,
} from '../../../../test/fake-session-db.js'
import type { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { MAX_CONTEXT_ARCHIVE_BYTES } from '../../cloud/context-archive/context-archive-limits'
import type { GithubService } from '../../cloud/github/github.service'
import { SandboxGitCredentials } from './git-credentials'
import { SandboxesService } from './sandboxes.service'
import { ESandboxState } from './sandboxes.types'
import { SandboxMissingError, type VercelSandboxClient } from './vercel-sandbox.client'
import { MAX_CONTEXT_BUNDLE_BYTES, MAX_WORKSPACE_PATCH_BYTES } from './workspace-spec'

const USER_A = 'user-a'
const USER_B = 'user-b'
const THREAD = 'brn_thread_1'

const fake = fakeSessionDb()

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
  workspaceSkills: null,
  workspaceContext: null,
  contextPending: true,
  workspaceProjectDirectory: null,
  sealedToken: null,
  sealedGitToken: null,
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

const TTL_MINUTES = 30
const MAX_SESSION_MINUTES = 240
const MAX_ACTIVE_PER_USER = 3

const ENV: Record<string, number> = {
  SANDBOX_TTL_MINUTES: TTL_MINUTES,
  SANDBOX_MAX_SESSION_MINUTES: MAX_SESSION_MINUTES,
  SANDBOX_MAX_ACTIVE_PER_USER: MAX_ACTIVE_PER_USER,
}
const env = { get: (key: string) => ENV[key] } as unknown as EnvService

const cipher = new SecretCipherService({
  get: (key: string) => (key === 'SECRETS_ENCRYPTION_KEY' ? '0'.repeat(64) : undefined),
} as unknown as EnvService)

const stubGithub = () => ({ findToken: vi.fn(async () => 'gho_user-token') })

const stubArchives = () => {
  const sandboxArchives = new Map<string, Buffer>()
  return {
    readSandboxArchive: vi.fn(async (a: { threadId: string }) => sandboxArchives.get(a.threadId) ?? null),
    writeSandboxArchive: vi.fn(async (a: { threadId: string; archive: Buffer }) => {
      sandboxArchives.set(a.threadId, a.archive)
    }),
    readUserArchive: vi.fn(async () => null),
    writeUserArchive: vi.fn(async () => undefined),
  }
}

const stubClient = () => ({
  getOrCreate: vi.fn(async () => ({
    sessionId: 'ses_created',
    url: 'https://atlas-3000.vercel.run',
    state: ESandboxState.Running,
    created: true,
  })),
  inspect: vi.fn(async (): Promise<{ state: ESandboxState; url?: string }> => ({
    state: ESandboxState.Parked,
  })),
  stop: vi.fn(async () => undefined),
  notifyParked: vi.fn(async () => undefined),
})

describe('SandboxesService quota', () => {
  let client: ReturnType<typeof stubClient>
  let service: SandboxesService

  const activeSandbox = (threadId: string) =>
    sandboxRow({
      threadId,
      userId: USER_A,
      lastActivityAt: new Date().toISOString(),
    })

  beforeEach(() => {
    fake.reset()
    fake.threads.push(threadRow({ id: THREAD }))
    client = stubClient()
    service = new SandboxesService(
      client as unknown as VercelSandboxClient,
      env,
      new SandboxGitCredentials(stubGithub() as unknown as GithubService),
      cipher,
      stubArchives() as unknown as ContextArchiveStore,
    )
  })

  it('refuses a first attach when the account is already at the active-sandbox cap', async () => {
    for (let i = 0; i < MAX_ACTIVE_PER_USER; i += 1) {
      fake.cloudSandboxes.push(activeSandbox(`brn_other_${i}`))
    }

    await expect(service.attach({ userId: USER_A, threadId: THREAD })).rejects.toMatchObject({
      status: 429,
    })
    await expect(service.attach({ userId: USER_A, threadId: THREAD })).rejects.toBeInstanceOf(
      HttpException,
    )
    expect(client.getOrCreate).not.toHaveBeenCalled()
  })

  it('ignores sandboxes that have been quiet longer than the TTL', async () => {
    for (let i = 0; i < MAX_ACTIVE_PER_USER; i += 1) {
      fake.cloudSandboxes.push(
        sandboxRow({
          threadId: `brn_stale_${i}`,
          userId: USER_A,
          lastActivityAt: '2020-01-01T00:00:00.000Z',
        }),
      )
    }

    const attachment = await service.attach({ userId: USER_A, threadId: THREAD })

    expect(attachment.threadId).toBe(THREAD)
  })

  it('lets an already-active thread re-attach without consuming another slot', async () => {
    for (let i = 0; i < MAX_ACTIVE_PER_USER - 1; i += 1) {
      fake.cloudSandboxes.push(activeSandbox(`brn_other_${i}`))
    }
    fake.cloudSandboxes.push(activeSandbox(THREAD))

    const attachment = await service.attach({ userId: USER_A, threadId: THREAD })

    expect(attachment.threadId).toBe(THREAD)
  })

  it('runs the quota check and the claim in one serializable transaction', async () => {
    const spy = vi.spyOn(fake.db, '$transaction')

    const attachment = await service.attach({ userId: USER_A, threadId: THREAD })

    expect(attachment.threadId).toBe(THREAD)
    expect(spy).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' })
    spy.mockRestore()
  })

  it('retries the claim when the serializable transaction aborts on a write skew', async () => {
    const original = fake.db.$transaction
    let calls = 0
    const spy = vi
      .spyOn(fake.db, '$transaction')
      .mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        calls += 1
        if (calls === 1) {
          throw new Prisma.PrismaClientKnownRequestError('serialization failure', {
            code: 'P2034',
            clientVersion: '7.9.1',
          })
        }
        return original(callback)
      })

    const attachment = await service.attach({ userId: USER_A, threadId: THREAD })

    expect(attachment.threadId).toBe(THREAD)
    expect(calls).toBe(2)
    spy.mockRestore()
  })

  it('surfaces the abort rather than looping once the retries are spent', async () => {
    const spy = vi
      .spyOn(fake.db, '$transaction')
      .mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('serialization failure', {
          code: 'P2034',
          clientVersion: '7.9.1',
        }),
      )

    await expect(service.attach({ userId: USER_A, threadId: THREAD })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    )
    expect(spy).toHaveBeenCalledTimes(3)
    spy.mockRestore()
  })
})

describe('SandboxesService', () => {
  let client: ReturnType<typeof stubClient>
  let github: ReturnType<typeof stubGithub>
  let archives: ReturnType<typeof stubArchives>
  let service: SandboxesService

  beforeEach(() => {
    fake.reset()
    fake.threads.push(threadRow({ id: THREAD }))
    client = stubClient()
    github = stubGithub()
    archives = stubArchives()
    service = new SandboxesService(
      client as unknown as VercelSandboxClient,
      env,
      new SandboxGitCredentials(github as unknown as GithubService),
      cipher,
      archives as unknown as ContextArchiveStore,
    )
  })

  afterEach(async () => {
    await service.whenSettled({ threadId: THREAD })
  })

  it('carries a drive mount and model pin from attach through provisioning', async () => {
    await service.attach({
      userId: USER_A,
      threadId: THREAD,
      drive: { name: 'factory-compai-atlas-341' },
      pinnedModel: 'inference/kimi-k3-fast',
    })
    await service.whenSettled({ threadId: THREAD })

    const row = fake.cloudSandboxes[0]
    expect(row?.driveName).toBe('factory-compai-atlas-341')
    expect(row?.pinnedModel).toBe('inference/kimi-k3-fast')

    const provisionCalls = client.getOrCreate.mock.calls as unknown as Array<
      [{ drive?: { name: string }; pinnedModel?: string }]
    >
    const provision = provisionCalls[0]?.[0]
    if (provision === undefined) throw new Error('expected a provisioning call')
    expect(provision.drive).toEqual({ name: 'factory-compai-atlas-341' })
    expect(provision.pinnedModel).toBe('inference/kimi-k3-fast')
  })

  it('re-provisions on every attach, reissuing the same stored token', async () => {
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
    expect(client.getOrCreate).toHaveBeenCalledTimes(2)
    expect(client.getOrCreate).toHaveBeenNthCalledWith(2, {
      name: fake.cloudSandboxes[0]?.name,
      threadId: THREAD,
      token: second.token,
    })
    expect(second.token).toBeDefined()
    expect(second.token).toBe(first.token)
    expect(fake.cloudSandboxes).toHaveLength(1)
  })

  it('marks a freshly created sandbox as owing a context upload', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    expect(fake.cloudSandboxes[0]?.contextPending).toBe(true)
  })

  it('clears the pending flag when the sandbox resumes from its snapshot instead of being created fresh', async () => {
    client.getOrCreate.mockResolvedValueOnce({
      sessionId: 'ses_resumed',
      url: 'https://atlas-3000.vercel.run',
      state: ESandboxState.Running,
      created: false,
    })

    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    expect(fake.cloudSandboxes[0]?.contextPending).toBe(false)
  })

  it('an attach with a caller-supplied name claims and provisions under that name', async () => {
    const attached = await service.attach({ userId: USER_A, threadId: THREAD, name: 'factory-fwi-1' })
    await service.whenSettled({ threadId: THREAD })

    expect(attached.name).toBe('factory-fwi-1')
    expect(fake.cloudSandboxes[0]?.name).toBe('factory-fwi-1')
    expect(client.getOrCreate).toHaveBeenCalledWith({
      name: 'factory-fwi-1',
      threadId: THREAD,
      token: attached.token,
    })
  })

  it('an attach without a name keeps the name the row was claimed under', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD, name: 'factory-fwi-1' })
    await service.whenSettled({ threadId: THREAD })

    const second = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    expect(second.name).toBe('factory-fwi-1')
    expect(client.getOrCreate).toHaveBeenNthCalledWith(2, {
      name: 'factory-fwi-1',
      threadId: THREAD,
      token: second.token,
    })
  })

  it('attach seals the session token onto the row', async () => {
    const attached = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    const sealed = fake.cloudSandboxes[0]?.sealedToken
    expect(sealed).toBeTruthy()
    expect(cipher.decrypt(sealed as string)).toBe(attached.token)
  })

  it('runningEndpoint reaches a live serve with its sealed token, without rotating it', async () => {
    const attached = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    client.inspect.mockResolvedValue({
      state: ESandboxState.Running,
      url: 'https://atlas-3000.vercel.run',
    })

    const endpoint = await service.runningEndpoint({ userId: USER_A, threadId: THREAD })

    expect(endpoint).toEqual({ token: attached.token, url: 'https://atlas-3000.vercel.run' })
    expect(client.getOrCreate).toHaveBeenCalledTimes(1)
  })

  it('runningEndpoint stands down when the sandbox is not running, unclaimed, or owned by another user', async () => {
    expect(await service.runningEndpoint({ userId: USER_A, threadId: THREAD })).toBeNull()

    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    client.inspect.mockResolvedValue({ state: ESandboxState.Parked })

    expect(await service.runningEndpoint({ userId: USER_A, threadId: THREAD })).toBeNull()

    client.inspect.mockResolvedValue({
      state: ESandboxState.Running,
      url: 'https://atlas-3000.vercel.run',
    })
    expect(await service.runningEndpoint({ userId: USER_B, threadId: THREAD })).toBeNull()
  })

  it('runningEndpoint stands down when the sealed token does not decrypt, so an attach re-seals it', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    const row = fake.cloudSandboxes[0]
    if (row === undefined) throw new Error('expected a claimed row')
    row.sealedToken = 'not-a-valid-blob'
    client.inspect.mockResolvedValue({
      state: ESandboxState.Running,
      url: 'https://atlas-3000.vercel.run',
    })

    expect(await service.runningEndpoint({ userId: USER_A, threadId: THREAD })).toBeNull()
  })

  it('park clears the sealed token', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    expect(fake.cloudSandboxes[0]?.sealedToken).toBeTruthy()

    await service.stop({ userId: USER_A, threadId: THREAD })

    expect(fake.cloudSandboxes[0]?.sealedToken).toBeNull()
    expect(fake.cloudSandboxes[0]?.state).toBe(ESandboxState.Parked)
  })

  /**
   * A parked sandbox loses its filesystem, so the serve it resumes into has no memory of the old
   * token — reissuing it would leave the new serve booted under a credential nothing has. The
   * resume must mint fresh and hand that exact token to `getOrCreate`, which is what the launcher
   * writes into the sandbox before starting serve.
   */
  it('mints a fresh token on resume from a park and hands it to provisioning, so serve boots with a token that still works', async () => {
    const first = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    await service.stop({ userId: USER_A, threadId: THREAD })
    expect(fake.cloudSandboxes[0]?.sealedToken).toBeNull()

    const resumed = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    expect(resumed.token).toBeDefined()
    expect(resumed.token).not.toBe(first.token)
    expect(client.getOrCreate).toHaveBeenLastCalledWith({
      name: fake.cloudSandboxes[0]?.name,
      threadId: THREAD,
      token: resumed.token,
    })
    expect(cipher.decrypt(fake.cloudSandboxes[0]?.sealedToken as string)).toBe(resumed.token)
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
        created: true,
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
        created: true,
      }
    })

    const first = await service.attach({ userId: USER_A, threadId: THREAD })
    expect(first.state).toBe(ESandboxState.Resuming)

    await vi.waitFor(() => expect(client.getOrCreate).toHaveBeenCalledTimes(1))

    const second = await service.attach({ userId: USER_A, threadId: THREAD })
    expect(second.state).toBe(ESandboxState.Resuming)
    expect(second.token).toBe(first.token)

    releaseCreate?.()
    await service.whenSettled({ threadId: THREAD })

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
        created: true,
      }
    })

    const firstAttached = await service.attach({ userId: USER_A, threadId: THREAD })
    const secondAttached = await service.attach({ userId: USER_A, threadId: THREAD })

    await vi.waitFor(() => expect(client.getOrCreate).toHaveBeenCalledTimes(1))

    releaseFirst?.()
    await service.whenSettled({ threadId: THREAD })

    expect(client.getOrCreate).toHaveBeenCalledTimes(2)
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
        created: true,
      }
    })

    const attaching = service.attach({ userId: USER_A, threadId: THREAD })
    await vi.waitFor(() => expect(client.getOrCreate).toHaveBeenCalledTimes(2))

    expect(fake.cloudSandboxes[0]?.lastActivityAt).not.toBe('2020-01-01T00:00:00.000Z')

    releaseCreate?.()
    await attaching
    await service.whenSettled({ threadId: THREAD })
  })

  it('returns the same stored token on every attach and stores only its hash in the clear', async () => {
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
    expect(second.token).toBe(token)
    expect(fake.cloudSandboxes[0]?.tokenHash).toBe(
      createHash('sha256')
        .update(second.token as string)
        .digest('hex'),
    )
  })

  it('list answers only the caller\'s sandboxes, most recently active first', async () => {
    fake.cloudSandboxes.push(
      sandboxRow({
        threadId: 'brn_old',
        name: 'atlas-old',
        driveName: 'atlas-drive-old',
        lastActivityAt: '2026-09-20T00:00:00.000Z',
      }),
      sandboxRow({
        threadId: THREAD,
        name: 'atlas-new',
        driveName: null,
        lastActivityAt: '2026-09-25T00:00:00.000Z',
      }),
      sandboxRow({
        threadId: 'brn_theirs',
        userId: USER_B,
        name: 'atlas-theirs',
        driveName: 'atlas-drive-theirs',
        lastActivityAt: '2026-09-26T00:00:00.000Z',
      }),
    )

    const entries = await service.list({ userId: USER_A })

    expect(entries).toEqual([
      {
        threadId: THREAD,
        name: 'atlas-new',
        driveName: null,
        state: ESandboxState.Running,
        lastActivityAt: '2026-09-25T00:00:00.000Z',
      },
      {
        threadId: 'brn_old',
        name: 'atlas-old',
        driveName: 'atlas-drive-old',
        state: ESandboxState.Running,
        lastActivityAt: '2026-09-20T00:00:00.000Z',
      },
    ])
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

  it('carries whether the context upload is still pending in the status dto', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    expect((await service.status({ userId: USER_A, threadId: THREAD })).contextPending).toBe(true)

    await service.putContextArchive({ userId: USER_A, threadId: THREAD, archive: Buffer.from('x') })

    expect((await service.status({ userId: USER_A, threadId: THREAD })).contextPending).toBe(false)
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

  it('rejects a wrong session token', async () => {
    const attached = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    await service.verifySessionToken({ threadId: THREAD, token: attached.token as string })
    await expect(
      service.verifySessionToken({ threadId: THREAD, token: 'not-the-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('stops a sandbox and marks it parked', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    const stopped = await service.stop({ userId: USER_A, threadId: THREAD })

    expect(client.stop).toHaveBeenCalledWith({ name: fake.cloudSandboxes[0]?.name })
    expect(stopped.state).toBe(ESandboxState.Parked)
    expect(fake.cloudSandboxes[0]?.state).toBe(ESandboxState.Parked)
  })

  it('destroy deletes only the row; the harness owns the vercel side now', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    await service.destroy({ userId: USER_A, threadId: THREAD })

    expect(fake.cloudSandboxes).toHaveLength(0)
  })

  it('answers 404 destroying a sandbox owned by another user, leaving it in place', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    await expect(
      service.destroy({ userId: USER_B, threadId: THREAD }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(fake.cloudSandboxes).toHaveLength(1)
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
      projectDirectory: null,
      gitIdentity: null,
      githubToken: 'gho_user-token',
      gpgKey: null,
      contextBundle: null,
    })
    expect(github.findToken).toHaveBeenCalledWith({ userId: USER_A })
  })

  it('carries the project directory from create through to the sandbox fetch', async () => {
    const spec = { ...SPEC, projectDirectory: '/Users/dennis/repos/atlas' }
    await service.attach({ userId: USER_A, threadId: THREAD, workspace: spec })
    await service.whenSettled({ threadId: THREAD })

    expect(fake.cloudSandboxes[0]?.workspaceProjectDirectory).toBe(spec.projectDirectory)
    await expect(service.workspace({ threadId: THREAD })).resolves.toMatchObject({
      projectDirectory: spec.projectDirectory,
    })
  })

  it('falls back to the outgoing workspaceSkills column when workspaceContext is unset', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD, workspace: SPEC })
    await service.whenSettled({ threadId: THREAD })
    const row = fake.cloudSandboxes[0]
    if (row === undefined) throw new Error('expected a sandbox row')
    row.workspaceSkills = JSON.stringify({ '.atlas/skills/review/SKILL.md': 'IyByZXZpZXc=' })
    row.workspaceContext = null

    await expect(service.workspace({ threadId: THREAD })).resolves.toMatchObject({
      contextBundle: row.workspaceSkills,
    })
  })

  it('never writes the outgoing workspaceSkills column on a fresh attach', async () => {
    const bundle = JSON.stringify({ '.atlas/skills/review/SKILL.md': 'IyByZXZpZXc=' })
    await service.attach({ userId: USER_A, threadId: THREAD, workspace: SPEC, contextBundle: bundle })
    await service.whenSettled({ threadId: THREAD })

    expect(fake.cloudSandboxes[0]?.workspaceContext).toBe(bundle)
    expect(fake.cloudSandboxes[0]?.workspaceSkills).toBeFalsy()
  })

  it('carries the context bundle through to the workspace fetch and refreshes it on re-attach', async () => {
    const bundle = JSON.stringify({ '.atlas/skills/review/SKILL.md': 'IyByZXZpZXc=' })
    await service.attach({ userId: USER_A, threadId: THREAD, workspace: SPEC, contextBundle: bundle })
    await service.whenSettled({ threadId: THREAD })

    await expect(service.workspace({ threadId: THREAD })).resolves.toMatchObject({
      contextBundle: bundle,
    })

    const fresher = JSON.stringify({ '.atlas/skills/review/SKILL.md': 'IyBuZXdlcg==' })
    await service.attach({ userId: USER_A, threadId: THREAD, contextBundle: fresher })
    await service.whenSettled({ threadId: THREAD })

    const fetched = await service.workspace({ threadId: THREAD })
    expect(fetched.contextBundle).toBe(fresher)
    expect(fetched.patch).toBe(SPEC.patch)
  })

  it('keeps the stored context bundle when a re-attach sends none', async () => {
    const bundle = JSON.stringify({ '.atlas/skills/review/SKILL.md': 'IyByZXZpZXc=' })
    await service.attach({ userId: USER_A, threadId: THREAD, workspace: SPEC, contextBundle: bundle })
    await service.whenSettled({ threadId: THREAD })

    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    await expect(service.workspace({ threadId: THREAD })).resolves.toMatchObject({
      contextBundle: bundle,
      patch: SPEC.patch,
    })
  })

  it('refuses a context bundle over the limit before claiming anything', async () => {
    const oversized = 'x'.repeat(MAX_CONTEXT_BUNDLE_BYTES + 1)

    await expect(
      service.attach({ userId: USER_A, threadId: THREAD, contextBundle: oversized }),
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
      projectDirectory: null,
      gitIdentity: null,
      githubToken: null,
      gpgKey: null,
      contextBundle: null,
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

  it('reissues the same session token on the same row instead of recreating the sandbox', async () => {
    const first = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    const rowId = fake.cloudSandboxes[0]?.id
    const name = fake.cloudSandboxes[0]?.name
    const sealedBefore = fake.cloudSandboxes[0]?.sealedToken

    const attached = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    expect(attached.token).toBeDefined()
    expect(attached.token).toBe(first.token)
    expect(client.getOrCreate).toHaveBeenCalledTimes(2)
    expect(fake.cloudSandboxes).toHaveLength(1)
    expect(fake.cloudSandboxes[0]?.id).toBe(rowId)
    expect(fake.cloudSandboxes[0]?.name).toBe(name)
    expect(fake.cloudSandboxes[0]?.sealedToken).toBe(sealedBefore)
    expect(fake.cloudSandboxes[0]?.tokenHash).toBe(
      createHash('sha256')
        .update(attached.token as string)
        .digest('hex'),
    )
  })

  it('mints a fresh token for a row that predates the stable-token change', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD, sealedToken: null }))

    const attached = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    expect(attached.token).toBeDefined()
    expect(fake.cloudSandboxes[0]?.sealedToken).toBeTruthy()
    expect(cipher.decrypt(fake.cloudSandboxes[0]?.sealedToken as string)).toBe(attached.token)
  })

  it('mints a fresh token instead of failing when the stored sealed token does not decrypt', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    fake.cloudSandboxes[0]!.sealedToken = 'not-a-valid-blob'

    const attached = await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    expect(attached.token).toBeDefined()
    expect(cipher.decrypt(fake.cloudSandboxes[0]?.sealedToken as string)).toBe(attached.token)
  })

  it('keeps the row and its workspace binding when the background provision fails, without rejecting the attach response', async () => {
    client.getOrCreate.mockRejectedValueOnce(new Error('vercel is unhappy'))

    const attached = await service.attach({ userId: USER_A, threadId: THREAD, workspace: SPEC })

    expect(attached.state).toBe(ESandboxState.Resuming)
    expect(attached.token).toBeDefined()

    await service.whenSettled({ threadId: THREAD })
    expect(fake.cloudSandboxes).toHaveLength(1)
    expect(fake.cloudSandboxes[0]?.workspaceCommit).toBe(SPEC.commit)
    await expect(service.status({ userId: USER_A, threadId: THREAD })).rejects.toThrow(
      'vercel is unhappy',
    )

    const retried = await service.attach({ userId: USER_A, threadId: THREAD })
    expect(retried.token).toBeDefined()
    expect(retried.token).toBe(attached.token)
    await service.whenSettled({ threadId: THREAD })
    await expect(service.status({ userId: USER_A, threadId: THREAD })).resolves.toBeDefined()
    expect(fake.cloudSandboxes).toHaveLength(1)
    expect(fake.cloudSandboxes[0]?.workspaceCommit).toBe(SPEC.commit)
  })

  it('stores and fetches the context archive through the store', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    const archive = Buffer.from('tar-gz-bytes')

    await service.putContextArchive({ userId: USER_A, threadId: THREAD, archive })

    expect(archives.writeSandboxArchive).toHaveBeenCalledWith({ threadId: THREAD, archive })
    await expect(service.getContextArchive({ threadId: THREAD })).resolves.toEqual(archive)
  })

  it('clears the pending context flag once the archive lands', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })
    expect(fake.cloudSandboxes[0]?.contextPending).toBe(true)

    await service.putContextArchive({
      userId: USER_A,
      threadId: THREAD,
      archive: Buffer.from('tar-gz-bytes'),
    })

    expect(fake.cloudSandboxes[0]?.contextPending).toBe(false)
  })

  it('answers null from getContextArchive when nothing has ever been stored', async () => {
    await expect(service.getContextArchive({ threadId: THREAD })).resolves.toBeNull()
  })

  it('refuses to store a context archive for a sandbox owned by another user', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    await expect(
      service.putContextArchive({ userId: USER_B, threadId: THREAD, archive: Buffer.from('x') }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(archives.writeSandboxArchive).not.toHaveBeenCalled()
  })

  it('refuses a context archive over the sanity cap', async () => {
    await service.attach({ userId: USER_A, threadId: THREAD })
    await service.whenSettled({ threadId: THREAD })

    await expect(
      service.putContextArchive({
        userId: USER_A,
        threadId: THREAD,
        archive: { byteLength: MAX_CONTEXT_ARCHIVE_BYTES + 1 } as unknown as Buffer,
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
    expect(archives.writeSandboxArchive).not.toHaveBeenCalled()
  })

  it('tolerates an HttpException from the client during background provisioning too, keeping the row', async () => {
    client.getOrCreate.mockRejectedValueOnce(new ServiceUnavailableException('not configured'))

    const attached = await service.attach({ userId: USER_A, threadId: THREAD })
    expect(attached.state).toBe(ESandboxState.Resuming)

    await service.whenSettled({ threadId: THREAD })
    expect(fake.cloudSandboxes).toHaveLength(1)
  })

  it('claim upserts the row and mints a fresh session token on every call, without touching vercel', async () => {
    const first = await service.claim({ userId: USER_A, threadId: THREAD, workspace: SPEC })

    expect(first.token).toBeDefined()
    expect(first.state).toBe(ESandboxState.Resuming)
    expect(first.contextPending).toBe(true)
    expect(client.getOrCreate).not.toHaveBeenCalled()
    expect(fake.cloudSandboxes[0]?.tokenHash).toBe(
      createHash('sha256')
        .update(first.token as string)
        .digest('hex'),
    )

    const second = await service.claim({ userId: USER_A, threadId: THREAD })

    expect(fake.cloudSandboxes).toHaveLength(1)
    expect(second.token).toBeDefined()
    expect(second.token).not.toBe(first.token)
    expect(cipher.decrypt(fake.cloudSandboxes[0]?.sealedToken as string)).toBe(second.token)
    expect(fake.cloudSandboxes[0]?.tokenHash).toBe(
      createHash('sha256')
        .update(second.token as string)
        .digest('hex'),
    )
    expect(client.getOrCreate).not.toHaveBeenCalled()
  })

  it('claim seals the git token onto the row, and the workspace fetch hands it back without asking the broker', async () => {
    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      workspace: SPEC,
      gitToken: 'gho_claim-token',
    })

    const sealed = fake.cloudSandboxes[0]?.sealedGitToken
    expect(sealed).toBeTruthy()
    expect(cipher.decrypt(sealed as string)).toBe('gho_claim-token')
    expect(JSON.stringify(fake.cloudSandboxes[0])).not.toContain('gho_claim-token')

    const workspace = await service.workspace({ threadId: THREAD })

    expect(workspace.githubToken).toBe('gho_claim-token')
    expect(github.findToken).not.toHaveBeenCalled()
  })

  it('claim refreshes the sealed git token on every claim that carries one', async () => {
    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      workspace: SPEC,
      gitToken: 'gho_first',
    })
    await service.claim({ userId: USER_A, threadId: THREAD, gitToken: 'gho_second' })

    const workspace = await service.workspace({ threadId: THREAD })

    expect(workspace.githubToken).toBe('gho_second')
    expect(github.findToken).not.toHaveBeenCalled()
  })

  it('a claim without a git token leaves the one already sealed on the row in place', async () => {
    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      workspace: SPEC,
      gitToken: 'gho_first',
    })
    await service.claim({ userId: USER_A, threadId: THREAD })

    const workspace = await service.workspace({ threadId: THREAD })

    expect(workspace.githubToken).toBe('gho_first')
    expect(github.findToken).not.toHaveBeenCalled()
  })

  it('the workspace fetch falls back to the credential broker when the claim carried no git token', async () => {
    await service.claim({ userId: USER_A, threadId: THREAD, workspace: SPEC })

    const workspace = await service.workspace({ threadId: THREAD })

    expect(workspace.githubToken).toBe('gho_user-token')
    expect(github.findToken).toHaveBeenCalledWith({ userId: USER_A })
  })

  it('claim writes the contextPending flag the caller sends, defaulting to pending', async () => {
    const pending = await service.claim({ userId: USER_A, threadId: THREAD })
    expect(pending.contextPending).toBe(true)
    expect(fake.cloudSandboxes[0]?.contextPending).toBe(true)

    const settled = await service.claim({
      userId: USER_A,
      threadId: THREAD,
      contextPending: false,
    })
    expect(settled.contextPending).toBe(false)
    expect(fake.cloudSandboxes[0]?.contextPending).toBe(false)
  })

  it('claim persists the git identity and the workspace fetch serves it back', async () => {
    const gitIdentity = { name: 'Dennis Lysenko', email: 'dennis@comp.ai' }
    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      workspace: { ...SPEC, gitIdentity },
    })

    const workspace = await service.workspace({ threadId: THREAD })

    expect(workspace.gitIdentity).toEqual(gitIdentity)
  })

  it('claim without a git identity serves gitIdentity as null', async () => {
    await service.claim({ userId: USER_A, threadId: THREAD, workspace: SPEC })

    const workspace = await service.workspace({ threadId: THREAD })

    expect(workspace.gitIdentity).toBeNull()
  })

  it('claim seals the gpg key onto the row, and the workspace fetch hands it back decrypted', async () => {
    const material = '{"privateKey":"priv","publicKey":"pub"}'
    await service.claim({ userId: USER_A, threadId: THREAD, workspace: SPEC, gpgKey: material })

    const sealed = fake.cloudSandboxes[0]?.sealedGpgKey
    expect(sealed).toBeTruthy()
    expect(cipher.decrypt(sealed as string)).toBe(material)
    expect(JSON.stringify(fake.cloudSandboxes[0])).not.toContain(material)

    const fetched = await service.workspace({ threadId: THREAD })

    expect(fetched.gpgKey).toBe(material)
  })

  it('a claim without a gpg key serves gpgKey as null', async () => {
    await service.claim({ userId: USER_A, threadId: THREAD, workspace: SPEC })

    await expect(service.workspace({ threadId: THREAD })).resolves.toMatchObject({
      gpgKey: null,
    })
  })

  it('a re-claim that omits the gpg key leaves the one already sealed on the row in place', async () => {
    const material = '{"privateKey":"priv"}'
    await service.claim({ userId: USER_A, threadId: THREAD, workspace: SPEC, gpgKey: material })
    await service.claim({ userId: USER_A, threadId: THREAD })

    const fetched = await service.workspace({ threadId: THREAD })

    expect(fetched.gpgKey).toBe(material)
  })

  it('an undecryptable sealed gpg key serves null instead of failing the workspace fetch', async () => {
    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      workspace: SPEC,
      gpgKey: '{"privateKey":"priv"}',
    })
    const row = fake.cloudSandboxes[0]
    if (row === undefined) throw new Error('expected a claimed row')
    row.sealedGpgKey = 'not-a-valid-blob'

    await expect(service.workspace({ threadId: THREAD })).resolves.toMatchObject({
      gpgKey: null,
    })
  })

  it('claim refuses an oversized patch before writing anything', async () => {
    const oversized = 'x'.repeat(MAX_WORKSPACE_PATCH_BYTES + 1)

    await expect(
      service.claim({
        userId: USER_A,
        threadId: THREAD,
        workspace: { ...SPEC, patch: oversized },
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
    expect(fake.cloudSandboxes).toHaveLength(0)
    expect(client.getOrCreate).not.toHaveBeenCalled()
  })

  it('claim refuses an oversized context bundle before writing anything', async () => {
    const oversized = 'x'.repeat(MAX_CONTEXT_BUNDLE_BYTES + 1)

    await expect(
      service.claim({ userId: USER_A, threadId: THREAD, contextBundle: oversized }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
    expect(fake.cloudSandboxes).toHaveLength(0)
  })

  it('claim persists the drive name the caller sends', async () => {
    await service.claim({ userId: USER_A, threadId: THREAD, driveName: 'atlas-drive-1' })

    expect(fake.cloudSandboxes[0]?.driveName).toBe('atlas-drive-1')
  })

  it('claim accepts an explicit null drive name, clearing the stored one', async () => {
    await service.claim({ userId: USER_A, threadId: THREAD, driveName: 'atlas-drive-1' })
    await service.claim({ userId: USER_A, threadId: THREAD, driveName: null })

    expect(fake.cloudSandboxes[0]?.driveName).toBeNull()
  })

  it('a claim without a drive name leaves the one already on the row in place', async () => {
    await service.claim({ userId: USER_A, threadId: THREAD, driveName: 'atlas-drive-1' })
    await service.claim({ userId: USER_A, threadId: THREAD })

    expect(fake.cloudSandboxes[0]?.driveName).toBe('atlas-drive-1')
  })

  it('claim answers 404 for a thread owned by another user', async () => {
    await expect(service.claim({ userId: USER_B, threadId: THREAD })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(fake.cloudSandboxes).toHaveLength(0)
  })
})
