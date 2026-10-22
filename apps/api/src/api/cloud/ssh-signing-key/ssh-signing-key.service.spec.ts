import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import {
  ESshSigningKeyState,
  GITHUB_NOT_CONNECTED_CODE,
  SSH_SIGNING_SCOPE_MISSING_CODE,
} from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { response } from './ssh-signing-key.fakes'
import {
  OLD_SCOPES,
  USER,
  cipher,
  connect,
  disconnect,
  keys,
  raceNextCreate,
  github,
  keyA,
  keyB,
  resetWorld,
} from './ssh-signing-key.service-support'
import type { SshSigningKeyService } from './ssh-signing-key.service'

describe('SshSigningKeyService', () => {
  useTestDatabase()
  let service: SshSigningKeyService

  beforeEach(async () => {
    service = await resetWorld()
  })

  it('stores the private half sealed and leases back the identical pem', async () => {
    const status = await service.register({ userId: USER, privateKey: keyA.privateKey })

    expect(status).toMatchObject({
      state: ESshSigningKeyState.Registered,
      publicKey: keyA.publicLine,
    })
    expect((await keys())[0]?.sealedPrivateKey).not.toContain('OPENSSH')
    expect((await keys())[0]).toMatchObject({
      githubKeyId: 101n,
      userName: 'octocat',
      userEmail: '4242+octocat@users.noreply.github.com',
    })
    const lease = await service.lease({ userId: USER })
    expect(lease).toEqual({
      publicKey: keyA.publicLine,
      privateKey: keyA.privateKey,
      userName: 'octocat',
      userEmail: '4242+octocat@users.noreply.github.com',
    })
    const upload = github.calls.find((call) => call.method === 'POST')
    expect(JSON.parse(upload?.body ?? '{}')).toEqual({
      key: keyA.publicLine,
      title: 'Atlas (octocat)',
    })
  })

  it('reports absent, then registered', async () => {
    await expect(service.status({ userId: USER })).resolves.toEqual({
      state: ESshSigningKeyState.Absent,
    })
    await service.register({ userId: USER, privateKey: keyA.privateKey })
    await expect(service.status({ userId: USER })).resolves.toMatchObject({
      state: ESshSigningKeyState.Registered,
    })
  })

  it('refuses a second registration with 409 and no github call', async () => {
    await service.register({ userId: USER, privateKey: keyA.privateKey })
    github.calls.length = 0

    await expect(
      service.register({ userId: USER, privateKey: keyB.privateKey }),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(github.calls).toHaveLength(0)
  })

  it('asks the user to connect github first', async () => {
    await disconnect()

    const failure = await service
      .register({ userId: USER, privateKey: keyA.privateKey })
      .catch((e: unknown) => e)

    expect(failure).toBeInstanceOf(ConflictException)
    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: GITHUB_NOT_CONNECTED_CODE,
    })
    expect(github.calls).toHaveLength(0)
  })

  it('answers the scope code for an old-scope connection without calling github', async () => {
    await disconnect()
    await connect({ scopes: OLD_SCOPES })

    const failure = await service
      .register({ userId: USER, privateKey: keyA.privateKey })
      .catch((e: unknown) => e)

    expect(failure).toBeInstanceOf(ForbiddenException)
    expect((failure as ForbiddenException).getResponse()).toMatchObject({
      code: SSH_SIGNING_SCOPE_MISSING_CODE,
    })
    expect(github.calls).toHaveLength(0)
    expect(await keys()).toHaveLength(0)
  })

  it('maps a github scope refusal to the scope code', async () => {
    github.override((call) => (call.method === 'POST' ? response({ status: 404 }) : undefined))

    await expect(
      service.register({ userId: USER, privateKey: keyA.privateKey }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(await keys()).toHaveLength(0)
  })

  it('adopts the existing key id when github answers 422', async () => {
    github.override((call) => {
      if (call.method === 'POST')
        return response({ status: 422, body: { message: 'key is already in use' } })
      if (call.method === 'GET' && call.url.includes('/user/ssh_signing_keys')) {
        return response({
          status: 200,
          body: [
            { id: 7, key: keyB.publicLine },
            { id: 9, key: `${keyA.publicLine} comment` },
          ],
        })
      }
      return undefined
    })

    await service.register({ userId: USER, privateKey: keyA.privateKey })

    expect((await keys())[0]?.githubKeyId).toBe(9n)
  })

  it('removes the just-registered key when a concurrent registration wins the row', async () => {
    raceNextCreate()

    await expect(
      service.register({ userId: USER, privateKey: keyA.privateKey }),
    ).rejects.toBeInstanceOf(ConflictException)

    expect(github.calls.at(-1)).toMatchObject({
      method: 'DELETE',
      url: expect.stringContaining('/101'),
    })
  })

  it('rotates: posts the new key, deletes the old id, swaps the row', async () => {
    await service.register({ userId: USER, privateKey: keyA.privateKey })
    github.calls.length = 0

    const status = await service.rotate({ userId: USER, privateKey: keyB.privateKey })

    expect(status).toMatchObject({
      state: ESshSigningKeyState.Registered,
      publicKey: keyB.publicLine,
    })
    expect(
      github.calls.map(
        (call) => `${call.method} ${call.url.replace('https://api.github.com', '')}`,
      ),
    ).toEqual(['GET /user', 'POST /user/ssh_signing_keys', 'DELETE /user/ssh_signing_keys/101'])
    expect((await keys())[0]).toMatchObject({ githubKeyId: 102n, publicKey: keyB.publicLine })
    expect(cipher.decrypt((await keys())[0]?.sealedPrivateKey ?? '')).toBe(keyB.privateKey)
    expect(github.registered.has(101)).toBe(false)
  })

  it('refuses a rotate with nothing registered', async () => {
    await expect(
      service.rotate({ userId: USER, privateKey: keyA.privateKey }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('revoke deletes the row even when github refuses the delete', async () => {
    await service.register({ userId: USER, privateKey: keyA.privateKey })
    github.override((call) => (call.method === 'DELETE' ? response({ status: 403 }) : undefined))

    await service.revoke({ userId: USER })

    expect(await keys()).toHaveLength(0)
    expect(github.calls.at(-1)?.method).toBe('DELETE')
  })

  it('revoke removes the key on github and is idempotent', async () => {
    await service.register({ userId: USER, privateKey: keyA.privateKey })

    await service.revoke({ userId: USER })
    await service.revoke({ userId: USER })

    expect(await keys()).toHaveLength(0)
    expect(github.registered.size).toBe(0)
  })

  it('leases 404 when no key is registered', async () => {
    await expect(service.lease({ userId: USER })).rejects.toBeInstanceOf(NotFoundException)
  })
})
