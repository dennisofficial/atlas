import type { INestApplication } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { encodeSettingValue } from '@dltech/atlas-wire/web'

import request from 'supertest'
import { as, buildSessionApp } from '../session-test-app'
import { seedSessionUsers } from '../web-settings.fake-db'
import { SecretsController } from '../secrets/secrets.controller'
import { SecretsService } from '../secrets/secrets.service'
import { SettingsController } from './settings.controller'
import { SettingsService } from './settings.service'

describe('personal settings and secrets HTTP surface', () => {
  useTestDatabase()
  const settings = () => db.orm.public.UserSetting.where((row) => row.id.neq('')).all()
  let app: INestApplication
  const http = () => request(app.getHttpServer())

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildSessionApp({
      controllers: [SettingsController, SecretsController],
      providers: [SettingsService, SecretsService],
    })
  })

  afterEach(() => app.close())

  it('PUT accepts raw legacy uploads that PATCH rejects', async () => {
    const uploads: Array<[string, unknown]> = [
      ['sandbox.vcpus', '4'],
      ['sandbox.vcpus', 3],
      ['sandbox.vcpus', 2.5],
      ['experimental.grillingCeremony', 'on'],
      ['model.id', 'garbage'],
    ]
    for (const [key, value] of uploads) {
      await http()
        .put(`/v1/settings/${key}`)
        .set(as('session-a'))
        .send({ value: encodeSettingValue(value) })
        .expect(204)
      await http()
        .patch('/v1/settings')
        .set(as('session-a'))
        .send({ values: { [key]: encodeSettingValue(value) } })
        .expect(400)
    }
    expect(await settings()).toHaveLength(3)
  })

  it('PUT passes an unknown key through untouched', async () => {
    await http()
      .put('/v1/settings/legacy.thing')
      .set(as('session-a'))
      .send({ value: 'anything' })
      .expect(204)
  })

  it('PATCH applies upserts and deletes together', async () => {
    await http()
      .put('/v1/settings/web.appearance.theme')
      .set(as('session-a'))
      .send({ value: encodeSettingValue('light') })
      .expect(204)

    await http()
      .patch('/v1/settings')
      .set(as('session-a'))
      .send({
        values: {
          'web.appearance.theme': null,
          'web.appearance.density': encodeSettingValue('compact'),
        },
      })
      .expect(204)

    const keys = (await settings()).map((row) => row.key)
    expect(keys).toEqual(['web.appearance.density'])
  })

  it('PATCH writes nothing when any entry is invalid', async () => {
    await http()
      .patch('/v1/settings')
      .set(as('session-a'))
      .send({
        values: {
          'web.appearance.density': encodeSettingValue('compact'),
          'web.appearance.codeFontSize': encodeSettingValue(99),
        },
      })
      .expect(400)
    expect(await settings()).toHaveLength(0)
  })

  it('PATCH rejects an empty patch, more than 100 keys, and a non-string value', async () => {
    await http().patch('/v1/settings').set(as('session-a')).send({ values: {} }).expect(400)
    const tooMany = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`legacy.key${index}`, 'x']),
    )
    await http().patch('/v1/settings').set(as('session-a')).send({ values: tooMany }).expect(400)
    await http()
      .patch('/v1/settings')
      .set(as('session-a'))
      .send({ values: { 'legacy.key': 5 } })
      .expect(400)
  })

  it('PATCH requires a session', async () => {
    await http()
      .patch('/v1/settings')
      .send({ values: { 'legacy.key': 'x' } })
      .expect(401)
  })

  it('stores a secret kind and keeps GET /v1/secrets free of it', async () => {
    await http()
      .put('/v1/secrets/OPENAI_KEY')
      .set(as('session-a'))
      .send({ value: 'sk-1', kind: 'env' })
      .expect(204)
    await http().put('/v1/secrets/plain').set(as('session-a')).send({ value: 'p' }).expect(204)
    await http()
      .put('/v1/secrets/OPENAI_KEY')
      .set(as('session-a'))
      .send({ value: 'sk-2' })
      .expect(204)

    const legacy = await http().get('/v1/secrets').set(as('session-a')).expect(200)
    expect(legacy.body.secrets).toHaveLength(2)
    for (const entry of legacy.body.secrets) {
      expect(Object.keys(entry).sort()).toEqual(['name', 'updatedAt', 'value'])
    }

    const details = await http().get('/v1/secrets/details').set(as('session-a')).expect(200)
    const kinds = Object.fromEntries(
      details.body.secrets.map((entry: { name: string; kind: string }) => [entry.name, entry.kind]),
    )
    expect(kinds).toEqual({ OPENAI_KEY: 'env', plain: 'secret' })
    expect(details.body.secrets[0]).toEqual(
      expect.objectContaining({ createdAt: expect.any(String), updatedAt: expect.any(String) }),
    )
  })

  it('rejects an unknown secret kind and scopes details to the caller', async () => {
    await http()
      .put('/v1/secrets/X')
      .set(as('session-a'))
      .send({ value: 'v', kind: 'weird' })
      .expect(400)
    await http().put('/v1/secrets/X').set(as('session-a')).send({ value: 'v' }).expect(204)
    const other = await http().get('/v1/secrets/details').set(as('session-b')).expect(200)
    expect(other.body.secrets).toEqual([])
    await http().get('/v1/secrets/details').expect(401)
  })
})
