import { createHash } from 'node:crypto'
import { UnauthorizedException } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { sandboxByThread, seedThreadRow, USER_A } from '../../../../test/session-seed'
import { cipher, prepareSandboxes, THREAD, type StubClient } from './sandboxes.fixture'
import type { SandboxesService } from './sandboxes.service'
import { ESandboxState } from './sandboxes.types'

describe('SandboxesService claim and token verification', () => {
  let client: StubClient
  useTestDatabase()
  let service: SandboxesService

  beforeEach(async () => {
    ;({ client, service } = await prepareSandboxes())
  })

  it('claims a row and mints a session token, without touching Vercel', async () => {
    const attachment = await service.claim({ userId: USER_A, threadId: THREAD })

    expect(attachment.threadId).toBe(THREAD)
    expect(attachment.token.length).toBeGreaterThan(0)
    expect(attachment.state).toBe(ESandboxState.Resuming)
    expect(client.inspect).not.toHaveBeenCalled()
    expect(client.stop).not.toHaveBeenCalled()

    const row = await sandboxByThread(THREAD)
    expect(row).toBeDefined()
    expect(row?.tokenHash).toBe(createHash('sha256').update(attachment.token).digest('hex'))
    expect(cipher.decrypt(row?.sealedToken ?? '')).toBe(attachment.token)
  })

  it('reissues a fresh token on every claim, re-sealing the git credential that rode up', async () => {
    const first = await service.claim({ userId: USER_A, threadId: THREAD, gitToken: 'gho_first' })
    const second = await service.claim({ userId: USER_A, threadId: THREAD, gitToken: 'gho_second' })

    expect(second.token).not.toBe(first.token)
    const row = await sandboxByThread(THREAD)
    expect(cipher.decrypt(row?.sealedGitToken ?? '')).toBe('gho_second')
  })

  it('keeps the stored git credential when a claim omits one', async () => {
    await service.claim({ userId: USER_A, threadId: THREAD, gitToken: 'gho_kept' })
    await service.claim({ userId: USER_A, threadId: THREAD })

    const row = await sandboxByThread(THREAD)
    expect(cipher.decrypt(row?.sealedGitToken ?? '')).toBe('gho_kept')
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

  it('lets the sandbox token reach its own thread and its sub-agents, nothing else', async () => {
    await seedThreadRow({ id: 'brn_child', spawnerThreadId: THREAD })

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
})
