import { ConflictException, ForbiddenException } from '@nestjs/common'
import { SSH_SIGNING_SCOPE_MISSING_CODE } from '@dltech/atlas-wire'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { PrismaClient } from '../../../generated/prisma/client'

mock.module('../../../db', () => ({ db: sharedSigningKeyDb.db as unknown as PrismaClient }))

import { response } from './ssh-signing-key.fakes'
import {
  GITHUB_API,
  USER,
  deletedIds,
  fake,
  github,
  keyA,
  keyB,
  resetWorld,
} from './ssh-signing-key.service-support'
import type { SshSigningKeyService } from './ssh-signing-key.service'
import { sharedSigningKeyDb } from '../../../../test/fake-signing-key-db.js'

const isKeyList = (url: string): boolean => url.includes('/user/ssh_signing_keys?')

function adoptKey(args: { id: number; key: string }): void {
  github.override((call) => {
    if (call.method === 'POST') return response({ status: 422 })
    if (call.method === 'GET' && isKeyList(call.url)) {
      return response({ status: 200, body: [{ id: args.id, key: args.key }] })
    }
    return undefined
  })
}

describe('SshSigningKeyService failure ordering', () => {
  let service: SshSigningKeyService

  beforeEach(() => {
    service = resetWorld()
  })

  describe('register', () => {
    it('keeps the github key and the row when a concurrent register of the same key adopts it', async () => {
      let posts = 0
      github.override((call) => {
        if (call.method === 'POST') {
          posts += 1
          if (posts === 2) return response({ status: 422 })
        }
        if (call.method === 'GET' && isKeyList(call.url)) {
          return response({ status: 200, body: [{ id: 101, key: keyA.publicLine }] })
        }
        return undefined
      })

      const outcomes = await Promise.allSettled([
        service.register({ userId: USER, privateKey: keyA.privateKey }),
        service.register({ userId: USER, privateKey: keyA.privateKey }),
      ])

      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected'])
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
      expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(ConflictException)
      expect(deletedIds()).toEqual([])
      expect(github.registered.has(101)).toBe(true)
      expect(fake.keys).toHaveLength(1)
      expect(fake.keys[0]?.githubKeyId).toBe(101n)
    })

    it('removes the created key when the row create fails', async () => {
      fake.failNext('create')

      await expect(service.register({ userId: USER, privateKey: keyA.privateKey })).rejects.toThrow(
        'injected create failure',
      )

      expect(deletedIds()).toEqual(['101'])
      expect(github.registered.size).toBe(0)
      expect(fake.keys).toHaveLength(0)
    })

    it('does not remove an adopted key when the row create fails', async () => {
      adoptKey({ id: 9, key: keyA.publicLine })
      fake.failNext('create')

      await expect(service.register({ userId: USER, privateKey: keyA.privateKey })).rejects.toThrow(
        'injected create failure',
      )

      expect(deletedIds()).toEqual([])
    })

    it('does not remove an adopted key when a concurrent register wins the row', async () => {
      adoptKey({ id: 9, key: keyA.publicLine })
      fake.raceNextCreate()

      await expect(service.register({ userId: USER, privateKey: keyA.privateKey })).rejects.toBeInstanceOf(
        ConflictException,
      )

      expect(deletedIds()).toEqual([])
    })

    it('still rethrows the create failure when removing the created key also fails', async () => {
      github.override((call) => (call.method === 'DELETE' ? response({ status: 500 }) : undefined))
      fake.failNext('create')

      await expect(service.register({ userId: USER, privateKey: keyA.privateKey })).rejects.toThrow(
        'injected create failure',
      )
    })

    it('answers the scope code when identity answers 401', async () => {
      github.override((call) => (call.url === `${GITHUB_API}/user` ? response({ status: 401 }) : undefined))

      const failure = await service.register({ userId: USER, privateKey: keyA.privateKey }).catch((e: unknown) => e)

      expect(failure).toBeInstanceOf(ForbiddenException)
      expect((failure as ForbiddenException).getResponse()).toMatchObject({ code: SSH_SIGNING_SCOPE_MISSING_CODE })
      expect(github.calls.some((call) => call.method === 'POST')).toBe(false)
    })
  })

  describe('rotate', () => {
    beforeEach(async () => {
      await service.register({ userId: USER, privateKey: keyA.privateKey })
      github.calls.length = 0
    })

    it('removes the new key and keeps the old row and github key when the swap throws', async () => {
      fake.failNext('updateMany')

      await expect(service.rotate({ userId: USER, privateKey: keyB.privateKey })).rejects.toThrow(
        'injected updateMany failure',
      )

      expect(fake.keys[0]).toMatchObject({ githubKeyId: 101n, publicKey: keyA.publicLine })
      expect(deletedIds()).toEqual(['102'])
      expect(github.registered.has(101)).toBe(true)
      expect(github.registered.has(102)).toBe(false)
    })

    it('answers 409, removes the new key and leaves the row when it changed concurrently', async () => {
      github.override((call) => {
        if (call.method === 'POST' && fake.keys[0] !== undefined) fake.keys[0].githubKeyId = 555n
        return undefined
      })

      const failure = await service.rotate({ userId: USER, privateKey: keyB.privateKey }).catch((e: unknown) => e)

      expect(failure).toBeInstanceOf(ConflictException)
      expect((failure as ConflictException).message).toBe('the signing key changed concurrently; retry')
      expect(fake.keys[0]).toMatchObject({ githubKeyId: 555n, publicKey: keyA.publicLine })
      expect(deletedIds()).toEqual(['102'])
    })

    it('does not remove an adopted new key when the swap throws', async () => {
      adoptKey({ id: 9, key: keyB.publicLine })
      fake.failNext('updateMany')

      await expect(service.rotate({ userId: USER, privateKey: keyB.privateKey })).rejects.toThrow(
        'injected updateMany failure',
      )

      expect(deletedIds()).toEqual([])
    })

    it.each([
      ['a 500', () => response({ status: 500 })],
      ['a 403', () => response({ status: 403 })],
      [
        'a network error',
        () => {
          throw new Error('socket hang up')
        },
      ],
    ])('still succeeds with the row swapped when deleting the old key fails with %s', async (_label, failWith) => {
      github.override((call) => (call.method === 'DELETE' && call.url.endsWith('/101') ? failWith() : undefined))

      const status = await service.rotate({ userId: USER, privateKey: keyB.privateKey })

      expect(status).toMatchObject({ publicKey: keyB.publicLine })
      expect(fake.keys[0]).toMatchObject({ githubKeyId: 102n, publicKey: keyB.publicLine })
      expect(deletedIds()).toEqual(['101'])
    })

    it('never deletes the key when rotating to the same public key', async () => {
      adoptKey({ id: 101, key: keyA.publicLine })

      await service.rotate({ userId: USER, privateKey: keyA.privateKey })

      expect(deletedIds()).toEqual([])
      expect(fake.keys[0]?.githubKeyId).toBe(101n)
    })
  })

  describe('revoke', () => {
    beforeEach(async () => {
      await service.register({ userId: USER, privateKey: keyA.privateKey })
      github.calls.length = 0
    })

    it('deletes the row before it calls github', async () => {
      let rowsWhenGithubWasCalled: number | undefined
      github.override((call) => {
        if (call.method === 'DELETE') rowsWhenGithubWasCalled = fake.keys.length
        return undefined
      })

      await service.revoke({ userId: USER })

      expect(rowsWhenGithubWasCalled).toBe(0)
      expect(deletedIds()).toEqual(['101'])
    })

    it.each([403, 500])('resolves with the row gone when the github delete answers %i', async (status) => {
      github.override((call) => (call.method === 'DELETE' ? response({ status }) : undefined))

      await expect(service.revoke({ userId: USER })).resolves.toBeUndefined()

      expect(fake.keys).toHaveLength(0)
      expect(deletedIds()).toEqual(['101'])
    })

    it('leaves the github key alone and makes no github call when the row delete fails', async () => {
      fake.failNext('deleteMany')

      await expect(service.revoke({ userId: USER })).rejects.toThrow('injected deleteMany failure')

      expect(fake.keys).toHaveLength(1)
      expect(github.calls).toHaveLength(0)
      expect(github.registered.has(101)).toBe(true)
    })

    it('just deletes the row when github is no longer connected', async () => {
      fake.connections.length = 0

      await service.revoke({ userId: USER })

      expect(fake.keys).toHaveLength(0)
      expect(github.calls).toHaveLength(0)
    })
  })
})
