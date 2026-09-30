import { createHash } from 'node:crypto'
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'
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
  sealedGpgKey: null,
  driveName: null,
  pinnedModel: null,
  serveUrl: null,
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

const cipher = new SecretCipherService({
  get: (key: string) => (key === 'SECRETS_ENCRYPTION_KEY' ? '0'.repeat(64) : undefined),
} as unknown as EnvService)

const stubGithub = () => ({ findToken: vi.fn(async () => 'gho_user-token') })

const stubArchives = () => {
  const sandboxArchives = new Map<string, Buffer>()
  return {
    readSandboxArchive: vi.fn(
      async (a: { threadId: string }) => sandboxArchives.get(a.threadId) ?? null,
    ),
    writeSandboxArchive: vi.fn(async (a: { threadId: string; archive: Buffer }) => {
      sandboxArchives.set(a.threadId, a.archive)
    }),
    readSandboxTranscript: vi.fn(async () => null),
    writeSandboxTranscript: vi.fn(async () => undefined),
    readUserArchive: vi.fn(async () => null),
    writeUserArchive: vi.fn(async () => undefined),
  }
}

const stubClient = () => ({
  inspect: vi.fn(async (): Promise<{ state: ESandboxState; url?: string }> => ({
    state: ESandboxState.Parked,
  })),
  stop: vi.fn(async () => undefined),
  notifyParked: vi.fn(async () => undefined),
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
      new SandboxGitCredentials(github as unknown as GithubService),
      cipher,
      archives as unknown as ContextArchiveStore,
    )
  })

  it('claims a row and mints a session token, without touching Vercel', async () => {
    const attachment = await service.claim({ userId: USER_A, threadId: THREAD })

    expect(attachment.threadId).toBe(THREAD)
    expect(attachment.token.length).toBeGreaterThan(0)
    expect(attachment.state).toBe(ESandboxState.Resuming)
    expect(client.inspect).not.toHaveBeenCalled()
    expect(client.stop).not.toHaveBeenCalled()

    const row = fake.cloudSandboxes.find((r) => r.threadId === THREAD)
    expect(row).toBeDefined()
    expect(row?.tokenHash).toBe(createHash('sha256').update(attachment.token).digest('hex'))
    expect(cipher.decrypt(row?.sealedToken ?? '')).toBe(attachment.token)
  })

  it('reissues a fresh token on every claim, re-sealing the git credential that rode up', async () => {
    const first = await service.claim({ userId: USER_A, threadId: THREAD, gitToken: 'gho_first' })
    const second = await service.claim({ userId: USER_A, threadId: THREAD, gitToken: 'gho_second' })

    expect(second.token).not.toBe(first.token)
    const row = fake.cloudSandboxes.find((r) => r.threadId === THREAD)
    expect(cipher.decrypt(row?.sealedGitToken ?? '')).toBe('gho_second')
  })

  it('keeps the stored git credential when a claim omits one', async () => {
    await service.claim({ userId: USER_A, threadId: THREAD, gitToken: 'gho_kept' })
    await service.claim({ userId: USER_A, threadId: THREAD })

    const row = fake.cloudSandboxes.find((r) => r.threadId === THREAD)
    expect(cipher.decrypt(row?.sealedGitToken ?? '')).toBe('gho_kept')
  })

  it('records the workspace spec and context bundle on the claim', async () => {
    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      workspace: SPEC,
      contextBundle: 'the bundle',
    })

    const row = fake.cloudSandboxes.find((r) => r.threadId === THREAD)
    expect(row?.workspaceRemoteUrl).toBe(SPEC.remoteUrl)
    expect(row?.workspaceBranch).toBe(SPEC.branch)
    expect(row?.workspaceCommit).toBe(SPEC.commit)
    expect(row?.workspacePatch).toBe(PATCH)
    expect(row?.workspaceContext).toBe('the bundle')
  })

  it('refuses a patch over the limit instead of truncating it', async () => {
    const oversized = { ...SPEC, patch: 'x'.repeat(MAX_WORKSPACE_PATCH_BYTES + 1) }

    await expect(
      service.claim({ userId: USER_A, threadId: THREAD, workspace: oversized }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
    expect(fake.cloudSandboxes).toHaveLength(0)
  })

  it('refuses a context bundle over the limit before claiming anything', async () => {
    const oversized = 'x'.repeat(MAX_CONTEXT_BUNDLE_BYTES + 1)

    await expect(
      service.claim({ userId: USER_A, threadId: THREAD, contextBundle: oversized }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
    expect(fake.cloudSandboxes).toHaveLength(0)
  })

  it('list answers only the caller’s sandboxes, most recently active first', async () => {
    fake.cloudSandboxes.push(
      sandboxRow({ threadId: 'brn_old', lastActivityAt: '2026-09-01T00:00:00.000Z' }),
      sandboxRow({ threadId: THREAD, lastActivityAt: '2026-09-16T00:00:00.000Z' }),
      sandboxRow({
        threadId: 'brn_other_user',
        userId: USER_B,
        lastActivityAt: '2026-09-20T00:00:00.000Z',
      }),
    )

    const listed = await service.list({ userId: USER_A })

    expect(listed.map((entry) => entry.threadId)).toEqual([THREAD, 'brn_old'])
  })

  it('reports the live state for the sidebar', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD }))
    client.inspect.mockResolvedValue({
      state: ESandboxState.Running,
      url: 'https://atlas-3000.vercel.run',
    })

    const status = await service.status({ userId: USER_A, threadId: THREAD })

    expect(status.state).toBe(ESandboxState.Running)
    expect(status.url).toBe('https://atlas-3000.vercel.run')
  })

  it('answers the stored state without a url when the sandbox is gone from Vercel', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD, state: ESandboxState.Parked }))
    client.inspect.mockRejectedValue(new SandboxMissingError('atlas-thread-brn_thread_1'))

    const status = await service.status({ userId: USER_A, threadId: THREAD })

    expect(status.state).toBe(ESandboxState.Parked)
    expect(status.url).toBeUndefined()
  })

  it('rejects a wrong session token and accepts the one the claim minted', async () => {
    const attachment = await service.claim({ userId: USER_A, threadId: THREAD })

    await expect(
      service.verifySessionToken({ threadId: THREAD, token: 'wrong-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException)

    const verified = await service.verifySessionToken({
      threadId: THREAD,
      token: attachment.token,
    })
    expect(verified.userId).toBe(USER_A)
  })

  it('stops a sandbox and marks it parked, clearing the sealed token', async () => {
    await service.claim({ userId: USER_A, threadId: THREAD })

    await service.stop({ userId: USER_A, threadId: THREAD })

    const claimed = fake.cloudSandboxes.find((r) => r.threadId === THREAD)
    expect(client.stop).toHaveBeenCalledWith({ name: claimed?.name })
    const row = fake.cloudSandboxes.find((r) => r.threadId === THREAD)
    expect(row?.state).toBe(ESandboxState.Parked)
    expect(row?.sealedToken).toBeNull()
  })

  it('notifies the sandbox before stopping it, with the operator-stop reason', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD, name: 'atlas-thread-named' }))

    await service.stop({ userId: USER_A, threadId: THREAD })

    expect(client.notifyParked).toHaveBeenCalledWith({
      name: 'atlas-thread-named',
      reason: 'the sandbox was stopped',
    })
  })

  it('still stops the sandbox when the in-sandbox notify fails', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD }))
    client.notifyParked.mockRejectedValue(new Error('sandbox unreachable'))

    await service.stop({ userId: USER_A, threadId: THREAD })

    expect(client.stop).toHaveBeenCalled()
    const row = fake.cloudSandboxes.find((r) => r.threadId === THREAD)
    expect(row?.state).toBe(ESandboxState.Parked)
  })

  it('destroy deletes only the row; the harness owns the vercel side now', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD }))

    await service.destroy({ userId: USER_A, threadId: THREAD })

    expect(fake.cloudSandboxes).toHaveLength(0)
    expect(client.stop).not.toHaveBeenCalled()
  })

  it('answers 404 destroying a sandbox owned by another user, leaving it in place', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD, userId: USER_A }))

    await expect(service.destroy({ userId: USER_B, threadId: THREAD })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(fake.cloudSandboxes).toHaveLength(1)
  })

  it('lets the sandbox token reach its own thread and its sub-agents, nothing else', async () => {
    fake.threads.push(threadRow({ id: 'brn_child', spawnerThreadId: THREAD }))

    await expect(
      service.assertThreadInFamily({ sandboxThreadId: THREAD, threadId: THREAD }),
    ).resolves.toBeUndefined()
    await expect(
      service.assertThreadInFamily({ sandboxThreadId: THREAD, threadId: 'brn_child' }),
    ).resolves.toBeUndefined()
    await expect(
      service.assertThreadInFamily({ sandboxThreadId: THREAD, threadId: 'brn_unrelated' }),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('stores and fetches the context archive through the store', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD }))
    const archive = Buffer.from('the context archive')

    await service.putContextArchive({ userId: USER_A, threadId: THREAD, archive })

    expect(archives.writeSandboxArchive).toHaveBeenCalledWith({ threadId: THREAD, archive })
    expect(await service.getContextArchive({ threadId: THREAD })).toEqual(archive)
  })

  it('refuses to store a context archive for a sandbox owned by another user', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD, userId: USER_A }))

    await expect(
      service.putContextArchive({ userId: USER_B, threadId: THREAD, archive: Buffer.from('x') }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(archives.writeSandboxArchive).not.toHaveBeenCalled()
  })

  it('refuses a context archive over the sanity cap', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD }))

    await expect(
      service.putContextArchive({
        userId: USER_A,
        threadId: THREAD,
        archive: Buffer.alloc(MAX_CONTEXT_ARCHIVE_BYTES + 1),
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
  })

  it('answers the workspace spec the claim recorded, with the claimed git credential and bundle', async () => {
    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      workspace: SPEC,
      contextBundle: 'the bundle',
      gitToken: 'gho_claimed',
    })

    const workspace = await service.workspace({ threadId: THREAD })

    expect(workspace.remoteUrl).toBe(SPEC.remoteUrl)
    expect(workspace.branch).toBe(SPEC.branch)
    expect(workspace.githubToken).toBe('gho_claimed')
    expect(workspace.contextBundle).toBe('the bundle')
    expect(github.findToken).not.toHaveBeenCalled()
  })

  it('answers a workspace spec without a token when github is not connected', async () => {
    github.findToken.mockResolvedValue(null as never)
    await service.claim({ userId: USER_A, threadId: THREAD, workspace: SPEC })

    const workspace = await service.workspace({ threadId: THREAD })

    expect(workspace.githubToken).toBeNull()
  })

  describe('the client-provisioned register path', () => {
    const CLIENT_TOKEN = 'a'.repeat(64)
    const SERVE_URL = 'https://atlas-3000-abc.vercel.run'

    it('stores the client token hashed and sealed, and echoes it back untouched', async () => {
      const registered = await service.claim({
        userId: USER_A,
        threadId: THREAD,
        clientToken: CLIENT_TOKEN,
        serveUrl: SERVE_URL,
      })

      expect(registered.token).toBe(CLIENT_TOKEN)
      expect(registered.url).toBe(SERVE_URL)
      expect(registered.state).toBe(ESandboxState.Running)
      expect(client.inspect).not.toHaveBeenCalled()

      const row = fake.cloudSandboxes.find((r) => r.threadId === THREAD)
      expect(row?.tokenHash).toBe(createHash('sha256').update(CLIENT_TOKEN).digest('hex'))
      expect(cipher.decrypt(row?.sealedToken ?? '')).toBe(CLIENT_TOKEN)
      expect(row?.serveUrl).toBe(SERVE_URL)

      const verified = await service.verifySessionToken({ threadId: THREAD, token: CLIENT_TOKEN })
      expect(verified.userId).toBe(USER_A)
    })

    it('marks the thread as cloud-executing and records the metadata it carried', async () => {
      await service.claim({
        userId: USER_A,
        threadId: THREAD,
        clientToken: CLIENT_TOKEN,
        serveUrl: SERVE_URL,
        metadata: { title: 'fix the flake', repo: 'compai/atlas', model: 'claude-opus-4-6' },
      })

      const thread = fake.threads.find((t) => t.id === THREAD)
      expect(thread?.executionLocation).toBe('cloud')
      expect(thread?.title).toBe('fix the flake')
      expect(thread?.repo).toBe('compai/atlas')
      expect(thread?.modelRef).toBe('claude-opus-4-6')
    })

    it('refuses a claim for a thread owned by another user, writing nothing', async () => {
      fake.threads.push(threadRow({ id: 'brn_theirs', userId: USER_B }))

      await expect(
        service.claim({
          userId: USER_A,
          threadId: 'brn_theirs',
          clientToken: CLIENT_TOKEN,
          serveUrl: SERVE_URL,
        }),
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(fake.cloudSandboxes).toHaveLength(0)
    })

    it('rejects a token that is not 32 bytes hex-encoded', async () => {
      await expect(
        service.claim({ userId: USER_A, threadId: THREAD, clientToken: 'tok_short', serveUrl: SERVE_URL }),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(fake.cloudSandboxes).toHaveLength(0)
    })

    it('requires a serve URL on the register path, refusing before any write', async () => {
      await expect(
        service.claim({ userId: USER_A, threadId: THREAD, clientToken: CLIENT_TOKEN }),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(fake.cloudSandboxes).toHaveLength(0)
    })

    it('rejects a serve URL that is not a Vercel sandbox https endpoint', async () => {
      for (const serveUrl of [
        'http://atlas-3000-abc.vercel.run',
        'not a url',
        'https://127.0.0.1:3000',
        'https://localhost',
        'https://10.0.0.4',
        'https://[::1]',
        'https://user:pass@atlas-3000-abc.vercel.run',
        'https://atlas-3000-abc.vercel.run/#frag',
        'https://atlas-3000-abc.vercel.run.',
        'https://atlas..vercel.run',
        'https://example.com',
        'https://vercel.run.evil.com',
        'https://vercel.run',
        `https://${'a'.repeat(240)}.vercel.run`,
      ]) {
        await expect(
          service.claim({ userId: USER_A, threadId: THREAD, clientToken: CLIENT_TOKEN, serveUrl }),
        ).rejects.toBeInstanceOf(BadRequestException)
      }
      expect(fake.cloudSandboxes).toHaveLength(0)
    })

    it("re-registration keeps the client's token rather than rotating it", async () => {
      const first = await service.claim({
        userId: USER_A,
        threadId: THREAD,
        clientToken: CLIENT_TOKEN,
        serveUrl: SERVE_URL,
      })
      const moved = await service.claim({
        userId: USER_A,
        threadId: THREAD,
        clientToken: CLIENT_TOKEN,
        serveUrl: 'https://atlas-3001-def.vercel.run',
      })

      expect(moved.token).toBe(first.token)
      expect(moved.url).toBe('https://atlas-3001-def.vercel.run')
      const row = fake.cloudSandboxes.find((r) => r.threadId === THREAD)
      expect(row?.serveUrl).toBe('https://atlas-3001-def.vercel.run')
      expect(cipher.decrypt(row?.sealedToken ?? '')).toBe(CLIENT_TOKEN)
    })

    it('registering a fresh client token replaces a rotated legacy one', async () => {
      const legacy = await service.claim({ userId: USER_A, threadId: THREAD })
      await service.claim({
        userId: USER_A,
        threadId: THREAD,
        clientToken: CLIENT_TOKEN,
        serveUrl: SERVE_URL,
      })

      await expect(
        service.verifySessionToken({ threadId: THREAD, token: legacy.token }),
      ).rejects.toBeInstanceOf(UnauthorizedException)
      const verified = await service.verifySessionToken({ threadId: THREAD, token: CLIENT_TOKEN })
      expect(verified.userId).toBe(USER_A)
    })

    it('runningEndpoint answers from the registered row without probing Vercel', async () => {
      await service.claim({
        userId: USER_A,
        threadId: THREAD,
        clientToken: CLIENT_TOKEN,
        serveUrl: SERVE_URL,
      })

      const endpoint = await service.runningEndpoint({ userId: USER_A, threadId: THREAD })

      expect(endpoint).toEqual({ token: CLIENT_TOKEN, url: SERVE_URL })
      expect(client.inspect).not.toHaveBeenCalled()
    })

    it('runningEndpoint falls back to the Vercel inspect for a pre-registration row', async () => {
      const attachment = await service.claim({ userId: USER_A, threadId: THREAD })
      client.inspect.mockResolvedValue({
        state: ESandboxState.Running,
        url: 'https://atlas-3000.vercel.run',
      })

      const endpoint = await service.runningEndpoint({ userId: USER_A, threadId: THREAD })

      expect(endpoint).toEqual({ token: attachment.token, url: 'https://atlas-3000.vercel.run' })
      expect(client.inspect).toHaveBeenCalled()
    })

    it('status answers running with the registered URL and no Vercel probe', async () => {
      await service.claim({
        userId: USER_A,
        threadId: THREAD,
        clientToken: CLIENT_TOKEN,
        serveUrl: SERVE_URL,
      })

      const status = await service.status({ userId: USER_A, threadId: THREAD })

      expect(status.state).toBe(ESandboxState.Running)
      expect(status.url).toBe(SERVE_URL)
      expect(client.inspect).not.toHaveBeenCalled()
    })

    it('status reports the stored parked state for a registered row, withholding the endpoint', async () => {
      await service.claim({
        userId: USER_A,
        threadId: THREAD,
        clientToken: CLIENT_TOKEN,
        serveUrl: SERVE_URL,
      })
      const row = fake.cloudSandboxes.find((r) => r.threadId === THREAD)
      if (row !== undefined) row.state = ESandboxState.Parked

      const status = await service.status({ userId: USER_A, threadId: THREAD })

      expect(status.state).toBe(ESandboxState.Parked)
      expect(status.url).toBeUndefined()
      expect(client.inspect).not.toHaveBeenCalled()
    })

    it('runningEndpoint withholds the attach endpoint once a registered row is parked', async () => {
      await service.claim({
        userId: USER_A,
        threadId: THREAD,
        clientToken: CLIENT_TOKEN,
        serveUrl: SERVE_URL,
      })
      const row = fake.cloudSandboxes.find((r) => r.threadId === THREAD)
      if (row !== undefined) row.state = ESandboxState.Parked

      expect(await service.runningEndpoint({ userId: USER_A, threadId: THREAD })).toBeNull()
      expect(client.inspect).not.toHaveBeenCalled()
    })

    it('runningEndpoint stops answering a legacy row once stop cleared its token', async () => {
      const attachment = await service.claim({ userId: USER_A, threadId: THREAD })
      await service.stop({ userId: USER_A, threadId: THREAD })

      expect(await service.runningEndpoint({ userId: USER_A, threadId: THREAD })).toBeNull()
      expect(attachment.token.length).toBeGreaterThan(0)
    })
  })
})
