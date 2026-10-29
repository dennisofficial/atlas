import { createHash } from 'node:crypto'
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  sandboxByThread,
  seedThreadRow,
  sessionOfThreadRow,
  threadById,
  USER_A,
  USER_B,
} from '../../../../test/session-seed'
import { cipher, prepareSandboxes, THREAD, type StubClient } from './sandboxes.fixture'
import type { SandboxesService } from './sandboxes.service'
import { ESandboxState } from './sandboxes.types'

describe('the client-provisioned register path', () => {
  let client: StubClient
  useTestDatabase()
  let service: SandboxesService

  beforeEach(async () => {
    ;({ client, service } = await prepareSandboxes())
  })

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

    const row = await sandboxByThread(THREAD)
    expect(row?.tokenHash).toBe(createHash('sha256').update(CLIENT_TOKEN).digest('hex'))
    expect(cipher.decrypt(row?.sealedToken ?? '')).toBe(CLIENT_TOKEN)
    expect(row?.serveUrl).toBe(SERVE_URL)

    const verified = await service.verifySessionToken({ threadId: THREAD, token: CLIENT_TOKEN })
    expect(verified.userId).toBe(USER_A)
  })

  it('stores the serve version the client reported, and keeps it when a re-registration omits it', async () => {
    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      clientToken: CLIENT_TOKEN,
      serveUrl: SERVE_URL,
      serveVersion: '1.42.0',
    })
    expect((await sandboxByThread(THREAD))?.serveVersion).toBe('1.42.0')

    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      clientToken: CLIENT_TOKEN,
      serveUrl: SERVE_URL,
    })
    expect((await sandboxByThread(THREAD))?.serveVersion).toBe('1.42.0')

    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      clientToken: CLIENT_TOKEN,
      serveUrl: SERVE_URL,
      serveVersion: '1.43.0',
    })
    expect((await sandboxByThread(THREAD))?.serveVersion).toBe('1.43.0')
  })

  it('marks the thread as cloud-executing and records the metadata it carried', async () => {
    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      clientToken: CLIENT_TOKEN,
      serveUrl: SERVE_URL,
      metadata: { title: 'fix the flake', repo: 'compai/atlas', model: 'claude-opus-4-6' },
    })

    const thread = await threadById(THREAD)
    const session = await sessionOfThreadRow(THREAD)
    expect(session?.executionLocation).toBe('cloud')
    expect(session?.title).toBe('fix the flake')
    expect(session?.repo).toBe('compai/atlas')
    expect(thread?.modelRef).toBe('claude-opus-4-6')
  })

  it('refuses a claim for a thread owned by another user, writing nothing', async () => {
    await seedThreadRow({ id: 'brn_theirs', userId: USER_B })

    await expect(
      service.claim({
        userId: USER_A,
        threadId: 'brn_theirs',
        clientToken: CLIENT_TOKEN,
        serveUrl: SERVE_URL,
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(await db.orm.public.CloudSandbox.all()).toHaveLength(0)
  })

  it('rejects a token that is not 32 bytes hex-encoded', async () => {
    await expect(
      service.claim({
        userId: USER_A,
        threadId: THREAD,
        clientToken: 'tok_short',
        serveUrl: SERVE_URL,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(await db.orm.public.CloudSandbox.all()).toHaveLength(0)
  })

  it('requires a serve URL on the register path, refusing before any write', async () => {
    await expect(
      service.claim({ userId: USER_A, threadId: THREAD, clientToken: CLIENT_TOKEN }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(await db.orm.public.CloudSandbox.all()).toHaveLength(0)
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
    expect(await db.orm.public.CloudSandbox.all()).toHaveLength(0)
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
    const row = await sandboxByThread(THREAD)
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
})
