import { EClassifierFault, ESettingId } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'

import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { ClassifierService } from './classifier.service'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const USER = 'user-classifier'
const GATEWAY_MODEL = 'gateway/typesafe-ai/jev'

const cipherOf = (): SecretCipherService =>
  new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))

const sealed = (value: unknown): string => cipherOf().encrypt(JSON.stringify(value))

const setting = (value: unknown): string => `atlas-setting:v1:${JSON.stringify(value)}`

const asFetch = (impl: () => Promise<Response>): typeof fetch => impl as unknown as typeof fetch

const answersWith = (noul: number | null): typeof fetch =>
  asFetch(async () =>
    noul === null
      ? new Response('refused', { status: 401 })
      : new Response(JSON.stringify({ answers: { connected: { noul } } }), { status: 200 }),
  )

const seedGatewayKey = async (): Promise<void> => {
  await db.orm.public.AgentAccount.create({
    id: 'acct-gateway',
    userId: USER,
    provider: 'gateway',
    kind: 'api-key',
    origin: 'login',
    label: 'AI Gateway key',
    status: 'active',
    sealedSecret: sealed({ kind: 'api-key', apiKey: 'gateway-key' }),
  })
  await db.orm.public.ActiveAccount.create({
    userId: USER,
    provider: 'gateway',
    accountId: 'acct-gateway',
  })
}

const seedClassifierModel = async (): Promise<void> => {
  await db.orm.public.UserSetting.create({
    id: 'set_classifier',
    userId: USER,
    key: ESettingId.ClassifierModel,
    value: setting(GATEWAY_MODEL),
  })
}

const serviceWith = (http: typeof fetch): ClassifierService =>
  new ClassifierService(cipherOf(), http)

describe('ClassifierService.test', () => {
  const database = useTestDatabase()

  beforeEach(async () => {
    await seedUser({ db: database().db, id: USER })
  })

  it('answers ok with the model and a duration when the classifier answers', async () => {
    await seedGatewayKey()
    await seedClassifierModel()

    const result = await serviceWith(answersWith(0.93)).test({ userId: USER })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model).toBe('typesafe-ai/jev')
    expect(result.ms).toBeGreaterThanOrEqual(0)
  })

  it('answers Rejected when the provider refuses the key', async () => {
    await seedGatewayKey()
    await seedClassifierModel()

    const result = await serviceWith(answersWith(null)).test({ userId: USER })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.fault).toBe(EClassifierFault.Rejected)
    expect(result.detail).toContain('401')
  })

  it('answers Unavailable without calling the provider when no model is set', async () => {
    await seedGatewayKey()
    let called = false
    const probe = asFetch(async () => {
      called = true
      return new Response(null, { status: 200 })
    })

    const result = await serviceWith(probe).test({ userId: USER })

    expect(result).toEqual({
      ok: false,
      fault: EClassifierFault.Unavailable,
      detail: 'no classifier model is set',
    })
    expect(called).toBe(false)
  })
})
