import { encodeSettingValue } from '@dltech/atlas-wire/web'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createPersonalApp, trpcMutate, trpcQuery } from '../personal-resources.router.fixture'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { SettingsRouter } from './settings.router'
import { SettingsService } from './settings.service'

describe('SettingsRouter', () => {
  useTestDatabase()
  const settings = () => db.orm.public.UserSetting.where((row) => row.id.neq('')).all()
  let app: INestApplication
  const mutate = (procedure: string, token: string | undefined, input: object) =>
    trpcMutate({ app, procedure, token, input })
  const list = (token?: string) => trpcQuery({ app, procedure: 'settings.list', token })

  beforeEach(async () => {
    await seedSessionUsers()
    app = await createPersonalApp([SettingsRouter, SettingsService])
  })

  afterEach(() => app.close())

  it('set and patch reject the same malformed values', async () => {
    const uploads: Array<[string, unknown]> = [
      ['sandbox.vcpus', '4'],
      ['sandbox.vcpus', 3],
      ['sandbox.vcpus', 2.5],
      ['experimental.grillingCeremony', 'on'],
      ['model.id', 'garbage'],
    ]
    for (const [key, value] of uploads) {
      const encoded = encodeSettingValue(value)
      await mutate('settings.set', 'session-a', { key, value: encoded }).expect(400)
      await mutate('settings.patch', 'session-a', { values: { [key]: encoded } }).expect(400)
    }
    expect(await settings()).toHaveLength(0)
  })

  it('set accepts a valid value for a known key', async () => {
    await mutate('settings.set', 'session-a', {
      key: 'sandbox.vcpus',
      value: encodeSettingValue(4),
    }).expect(200)
    expect(await settings()).toHaveLength(1)
  })

  it('set passes an unknown key through untouched', async () => {
    await mutate('settings.set', 'session-a', { key: 'legacy.thing', value: 'anything' }).expect(
      200,
    )
  })

  it('patch applies upserts and deletes together', async () => {
    await mutate('settings.set', 'session-a', {
      key: 'web.appearance.theme',
      value: encodeSettingValue('light'),
    }).expect(200)

    await mutate('settings.patch', 'session-a', {
      values: {
        'web.appearance.theme': null,
        'web.appearance.density': encodeSettingValue('compact'),
      },
    }).expect(200)

    expect((await settings()).map((row) => row.key)).toEqual(['web.appearance.density'])
  })

  it('patch writes nothing when any entry is invalid', async () => {
    await mutate('settings.patch', 'session-a', {
      values: {
        'web.appearance.density': encodeSettingValue('compact'),
        'web.appearance.codeFontSize': encodeSettingValue(99),
      },
    }).expect(400)
    expect(await settings()).toHaveLength(0)
  })

  it('patch rejects an empty patch, more than 100 keys, a non-string value and an unknown property', async () => {
    await mutate('settings.patch', 'session-a', { values: {} }).expect(400)
    const tooMany = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`legacy.key${index}`, 'x']),
    )
    await mutate('settings.patch', 'session-a', { values: tooMany }).expect(400)
    await mutate('settings.patch', 'session-a', { values: { 'legacy.key': 5 } }).expect(400)
    await mutate('settings.patch', 'session-a', {
      values: { 'legacy.key': 'x' },
      bogus: true,
    }).expect(400)
    expect(await settings()).toHaveLength(0)
  })

  it('patch requires a session', async () => {
    await mutate('settings.patch', undefined, { values: { 'legacy.key': 'x' } }).expect(401)
  })

  describe('pod-delivered settings', () => {
    const podDelivered = {
      'decisions.provider': 'custom',
      'decisions.url': 'https://jev.internal',
      'decisions.model': 'jev-luna',
      'classifier.mode': 'nudge',
      'web.searchBackend': 'exa',
    }

    it('stores and lists the five settings for the personal scope', async () => {
      const values = Object.fromEntries(
        Object.entries(podDelivered).map(([key, value]) => [key, encodeSettingValue(value)]),
      )
      await mutate('settings.patch', 'session-a', { values }).expect(200)

      const listed = (await list('session-a').expect(200)).body.result.data.settings
      const keys = listed.map((setting: { key: string }) => setting.key).sort()
      expect(keys).toEqual(Object.keys(podDelivered).sort())
    })

    it('rejects an invalid classifier mode', async () => {
      await mutate('settings.patch', 'session-a', {
        values: { 'classifier.mode': encodeSettingValue('interrupt') },
      }).expect(400)
      expect(await settings()).toHaveLength(0)
    })

    it('rejects a decisions endpoint that is not an absolute http(s) URL', async () => {
      await mutate('settings.patch', 'session-a', {
        values: { 'decisions.url': encodeSettingValue('jev.internal') },
      }).expect(400)
      expect(await settings()).toHaveLength(0)
    })
  })

  describe('pod reach', () => {
    beforeEach(async () => {
      const stamp = new Date('2026-10-03T00:00:00.000Z')
      for (const [userId, value] of [
        ['user-a', 'image-a'],
        ['user-b', 'image-b'],
      ] as const) {
        await db.orm.public.UserSetting.create({
          id: `set_${userId}`,
          userId,
          key: 'sandbox.image',
          value,
          createdAt: stamp,
          updatedAt: stamp,
        })
      }
    })

    it("reads the pod owner's settings only, no-store", async () => {
      const reply = await list('pod-token-a').expect(200)

      expect(reply.headers['cache-control']).toBe('no-store')
      expect(reply.body.result.data.settings).toEqual([
        { key: 'sandbox.image', value: 'image-a', updatedAt: '2026-10-03T00:00:00.000Z' },
      ])
    })

    it('lets a sandbox principal read its owner’s settings', async () => {
      const reply = await list('sandbox-token-a').expect(200)

      expect(reply.body.result.data.settings).toHaveLength(1)
    })

    it('refuses a pod bearer on every settings write', async () => {
      const pod = 'pod-token-a'
      await mutate('settings.set', pod, { key: 'sandbox.image', value: 'x' }).expect(401)
      await mutate('settings.remove', pod, { key: 'sandbox.image' }).expect(401)
      await mutate('settings.patch', pod, { values: { 'sandbox.image': 'x' } }).expect(401)
      expect((await settings()).map((row) => row.value).sort()).toEqual(['image-a', 'image-b'])
    })

    it('refuses a sandbox bearer on a personal write', async () => {
      await mutate('settings.set', 'sandbox-token-a', { key: 'sandbox.image', value: 'x' }).expect(
        401,
      )
      expect((await settings()).map((row) => row.value).sort()).toEqual(['image-a', 'image-b'])
    })

    it('still lists and removes settings for a session', async () => {
      expect((await list('session-a').expect(200)).body.result.data.settings).toHaveLength(1)

      const removed = await mutate('settings.remove', 'session-a', { key: 'sandbox.image' })
      expect(removed.status).toBe(200)
      expect(removed.body).toEqual({ result: {} })
      expect(await db.orm.public.UserSetting.where({ userId: 'user-a' }).all()).toHaveLength(0)
    })

    it('answers 401 to a missing bearer', async () => {
      await list().expect(401)
    })
  })
})
