import { ConflictException } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { response } from './ssh-signing-key.fakes'
import {
  USER,
  deletedIds,
  github,
  keyA,
  keyB,
  keys,
  resetWorld,
} from './ssh-signing-key.service-support'
import type { SshSigningKeyService } from './ssh-signing-key.service'

const isKeyList = (url: string): boolean => url.includes('/user/ssh_signing_keys?')

function listOnGithub(args: { id: number; key: string }): void {
  github.override((call) =>
    call.method === 'GET' && isKeyList(call.url)
      ? response({ status: 200, body: [{ id: args.id, key: args.key }] })
      : undefined,
  )
}

function parkCreatorWhile(args: { id: number; key: string; rival: () => Promise<unknown> }): {
  rival: () => Promise<unknown> | undefined
} {
  let rival: Promise<unknown> | undefined
  github.override(async (call) => {
    if (call.method !== 'POST') return undefined
    if (rival !== undefined) return response({ status: 422 })
    github.registered.set(args.id, args.key)
    rival = args.rival()
    await rival.catch(() => undefined)
    return response({ status: 201, body: { id: args.id, key: args.key } })
  })
  return { rival: () => rival }
}

describe('SshSigningKeyService concurrent registrations of one key', () => {
  useTestDatabase()
  let service: SshSigningKeyService

  beforeEach(async () => {
    service = await resetWorld()
  })

  it('keeps the github key when the register that adopted it wins the row', async () => {
    listOnGithub({ id: 101, key: keyA.publicLine })
    const parked = parkCreatorWhile({
      id: 101,
      key: keyA.publicLine,
      rival: () => service.register({ userId: USER, privateKey: keyA.privateKey }),
    })

    const creator = await service
      .register({ userId: USER, privateKey: keyA.privateKey })
      .catch((e: unknown) => e)

    expect(creator).toBeInstanceOf(ConflictException)
    expect(await parked.rival()).toMatchObject({ publicKey: keyA.publicLine })
    expect(deletedIds()).toEqual([])
    expect(github.registered.has(101)).toBe(true)
    expect((await keys()).map((row) => row.githubKeyId)).toEqual([101n])
  })

  it('keeps the github key when the register that created it wins the row', async () => {
    let creator: Promise<unknown> | undefined
    let adopter: Promise<unknown> | undefined
    github.override(async (call) => {
      if (call.method === 'GET' && isKeyList(call.url)) {
        await creator
        return response({ status: 200, body: [{ id: 101, key: keyA.publicLine }] })
      }
      if (call.method !== 'POST') return undefined
      if (adopter !== undefined) return response({ status: 422 })
      adopter = service
        .register({ userId: USER, privateKey: keyA.privateKey })
        .catch((e: unknown) => e)
      return undefined
    })

    creator = service.register({ userId: USER, privateKey: keyA.privateKey })

    expect(await creator).toMatchObject({ publicKey: keyA.publicLine })
    expect(await adopter).toBeInstanceOf(ConflictException)
    expect(deletedIds()).toEqual([])
    expect(github.registered.has(101)).toBe(true)
    expect((await keys()).map((row) => row.githubKeyId)).toEqual([101n])
  })

  it('keeps the new github key when the rotate that adopted it wins the swap', async () => {
    await service.register({ userId: USER, privateKey: keyA.privateKey })
    github.calls.length = 0
    listOnGithub({ id: 102, key: keyB.publicLine })
    const parked = parkCreatorWhile({
      id: 102,
      key: keyB.publicLine,
      rival: () => service.rotate({ userId: USER, privateKey: keyB.privateKey }),
    })

    const creator = await service
      .rotate({ userId: USER, privateKey: keyB.privateKey })
      .catch((e: unknown) => e)

    expect(creator).toBeInstanceOf(ConflictException)
    expect(await parked.rival()).toMatchObject({ publicKey: keyB.publicLine })
    expect(deletedIds()).toEqual(['101'])
    expect(github.registered.has(102)).toBe(true)
    expect((await keys()).map((row) => row.githubKeyId)).toEqual([102n])
  })
})
