import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { SecretsService } from './secrets.service'

const HEX_KEY =
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

const USER_A = 'user-a'
const USER_B = 'user-b'

describe('SecretsService', () => {
  const database = useTestDatabase()
  const secrets = () => db.orm.public.UserSecret.where((row) => row.id.neq('')).all()
  let service: SecretsService

  beforeEach(async () => {
    for (const id of [USER_A, USER_B]) await seedUser({ db: database().db, id })
    service = new SecretsService(
      new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY })),
    )
  })

  it('set seals the value and list returns it decrypted', async () => {
    await service.set({ userId: USER_A, name: 'web.searchKey', value: 'sk-search-1' })

    const stored = (await secrets())[0]
    expect(stored?.id).toMatch(/^sec_/)
    expect(stored?.sealedValue).not.toContain('sk-search-1')

    expect(await service.list({ userId: USER_A })).toEqual([
      {
        name: 'web.searchKey',
        value: 'sk-search-1',
        updatedAt: stored?.updatedAt.toISOString(),
      },
    ])
  })

  it('set upserts an existing name and bumps updatedAt', async () => {
    await service.set({ userId: USER_A, name: 'web.searchKey', value: 'old-value' })
    const sealedBefore = (await secrets())[0]?.sealedValue

    await service.set({ userId: USER_A, name: 'web.searchKey', value: 'new-value' })

    const rows = await secrets()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.sealedValue).not.toBe(sealedBefore)
    expect((await service.list({ userId: USER_A }))[0]?.value).toBe('new-value')
  })

  it('list scopes to the owning user', async () => {
    await service.set({ userId: USER_A, name: 'web.searchKey', value: 'sk-search-1' })

    expect(await service.list({ userId: USER_B })).toEqual([])
  })

  it('the same name under different users stays independent', async () => {
    await service.set({ userId: USER_A, name: 'shared', value: 'value-a' })
    await service.set({ userId: USER_B, name: 'shared', value: 'value-b' })

    expect((await service.list({ userId: USER_A }))[0]?.value).toBe('value-a')
    expect((await service.list({ userId: USER_B }))[0]?.value).toBe('value-b')
  })

  it('remove deletes only the caller’s own entry and tolerates unknown names', async () => {
    await service.set({ userId: USER_A, name: 'web.searchKey', value: 'sk-search-1' })
    await service.set({ userId: USER_B, name: 'web.searchKey', value: 'sk-search-2' })

    await service.remove({ userId: USER_A, name: 'web.searchKey' })
    await service.remove({ userId: USER_A, name: 'never-existed' })

    expect(await secrets()).toHaveLength(1)
    expect((await service.list({ userId: USER_B }))[0]?.value).toBe('sk-search-2')
  })

  it('rejects empty and over-long names', async () => {
    await expect(service.set({ userId: USER_A, name: '', value: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
    await expect(
      service.set({ userId: USER_A, name: 'n'.repeat(201), value: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.remove({ userId: USER_A, name: 'n'.repeat(201) }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(await secrets()).toHaveLength(0)
  })
})
