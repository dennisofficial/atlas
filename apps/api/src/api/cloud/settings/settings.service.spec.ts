import { BadRequestException } from '@nestjs/common'
import { encodeSettingValue } from '@dltech/atlas-wire/web'
import { beforeEach, describe, expect, it } from 'bun:test'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { SettingsService } from './settings.service'

const USER_A = 'user-a'
const USER_B = 'user-b'

describe('SettingsService', () => {
  const database = useTestDatabase()
  const settings = () => db.orm.public.UserSetting.where((row) => row.id.neq('')).all()
  let service: SettingsService

  beforeEach(async () => {
    for (const id of [USER_A, USER_B]) await seedUser({ db: database().db, id })
    service = new SettingsService()
  })

  it('set stores the value in plain text and list returns it', async () => {
    await service.set({ userId: USER_A, key: 'sandbox.image', value: 'img-1' })

    const stored = (await settings())[0]
    expect(stored?.id).toMatch(/^set_/)
    expect(stored?.value).toBe('img-1')

    expect<unknown>(await service.list({ userId: USER_A })).toEqual([
      {
        key: 'sandbox.image',
        value: 'img-1',
        updatedAt: stored?.updatedAt.toISOString(),
      },
    ])
  })

  it('set upserts an existing key and bumps updatedAt', async () => {
    await service.set({ userId: USER_A, key: 'sandbox.image', value: 'old-value' })
    const updatedAtBefore = (await settings())[0]?.updatedAt

    await new Promise((resolve) => setTimeout(resolve, 5))
    await service.set({ userId: USER_A, key: 'sandbox.image', value: 'new-value' })

    const rows = await settings()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.updatedAt.getTime()).toBeGreaterThan(updatedAtBefore?.getTime() ?? 0)
    expect((await service.list({ userId: USER_A }))[0]?.value).toBe('new-value')
  })

  it('list scopes to the owning user', async () => {
    await service.set({ userId: USER_A, key: 'sandbox.image', value: 'img-1' })

    expect(await service.list({ userId: USER_B })).toEqual([])
  })

  it('the same key under different users stays independent', async () => {
    await service.set({ userId: USER_A, key: 'shared', value: 'value-a' })
    await service.set({ userId: USER_B, key: 'shared', value: 'value-b' })

    expect((await service.list({ userId: USER_A }))[0]?.value).toBe('value-a')
    expect((await service.list({ userId: USER_B }))[0]?.value).toBe('value-b')
  })

  it('remove deletes only the caller’s own entry and tolerates unknown keys', async () => {
    await service.set({ userId: USER_A, key: 'sandbox.image', value: 'img-1' })
    await service.set({ userId: USER_B, key: 'sandbox.image', value: 'img-2' })

    await service.remove({ userId: USER_A, key: 'sandbox.image' })
    await service.remove({ userId: USER_A, key: 'never.existed' })

    expect(await settings()).toHaveLength(1)
    expect((await service.list({ userId: USER_B }))[0]?.value).toBe('img-2')
  })

  it('rejects empty and over-long keys', async () => {
    await expect(service.set({ userId: USER_A, key: '', value: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
    await expect(
      service.set({ userId: USER_A, key: 'k'.repeat(201), value: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.remove({ userId: USER_A, key: 'k'.repeat(201) })).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(await settings()).toHaveLength(0)
  })

  it('rejects keys that are not dot-separated segments', async () => {
    const invalid = ['sandbox..image', '-sandbox', 'sandbox.', '1sandbox', 'a b', '.sandbox']
    for (const key of invalid) {
      await expect(service.set({ userId: USER_A, key, value: 'x' })).rejects.toBeInstanceOf(
        BadRequestException,
      )
    }
    expect(await settings()).toHaveLength(0)
  })

  it('accepts dotted keys with camelCase, digits and dashes in later segments', async () => {
    await service.set({ userId: USER_A, key: 'sandbox.vercelTeamId', value: 'x' })
    await service.set({ userId: USER_A, key: 'sandbox.team-2.project3', value: 'y' })

    expect((await service.list({ userId: USER_A })).map((row) => row.key)).toEqual([
      'sandbox.team-2.project3',
      'sandbox.vercelTeamId',
    ])
  })

  describe('set validates values the same as patch', () => {
    const malformedUploads: Array<[string, string]> = [
      ['sandbox.vcpus', encodeSettingValue('4')],
      ['sandbox.vcpus', encodeSettingValue(3)],
      ['sandbox.vcpus', encodeSettingValue(2.5)],
      ['experimental.grillingCeremony', encodeSettingValue('on')],
      ['model.id', encodeSettingValue('garbage')],
    ]

    it('set and patch reject the same malformed values', async () => {
      for (const [key, value] of malformedUploads) {
        await expect(service.set({ userId: USER_A, key, value })).rejects.toBeInstanceOf(
          BadRequestException,
        )
        await expect(
          service.patch({ userId: USER_A, values: { [key]: value } }),
        ).rejects.toBeInstanceOf(BadRequestException)
      }
      expect(await settings()).toHaveLength(0)
    })

    it('set still accepts a valid value for a known key and an unknown key', async () => {
      await service.set({ userId: USER_A, key: 'sandbox.vcpus', value: encodeSettingValue(4) })
      await service.set({ userId: USER_A, key: 'anything.else', value: encodeSettingValue('raw') })

      expect(await settings()).toHaveLength(2)
    })

    it('set still refuses a malformed key', async () => {
      await expect(
        service.set({ userId: USER_A, key: 'sandbox..vcpus', value: encodeSettingValue(4) }),
      ).rejects.toBeInstanceOf(BadRequestException)
    })
  })
})
