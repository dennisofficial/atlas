import { db, sharedPool } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSandboxRow, seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import type { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { inertSignals } from '../sessions/thread-signals.fixture'
import { notifyPrincipalRevoked } from './sandbox-principal-notify'
import { PRINCIPAL_WATCH_APPLICATION_NAME } from './sandbox-principal-watch'
import { hashSessionToken } from './sandbox-tokens'
import { databaseEnv, envWithoutDatabase } from './sandboxes.fixture'
import { SandboxesService } from './sandboxes.service'
import { ETokenPrincipalKind } from './token-principal'
import type { VercelSandboxClient } from './vercel-sandbox.client'

const THREAD = 'brn_revoke'
const TOKEN = 'revocable-sandbox-token'

const cipher = new SecretCipherService({
  get: (key: string) => (key === 'SECRETS_ENCRYPTION_KEY' ? '0'.repeat(64) : undefined),
} as unknown as EnvService)

const newService = (env: EnvService = databaseEnv()): SandboxesService =>
  new SandboxesService({} as unknown as VercelSandboxClient, cipher, inertSignals(), env)

const openWatches = async (): Promise<number> => {
  const { rows } = await sharedPool().query<{ count: string }>(
    'SELECT count(*) FROM pg_stat_activity WHERE application_name = $1 AND datname = current_database()',
    [PRINCIPAL_WATCH_APPLICATION_NAME],
  )
  return Number(rows[0]?.count ?? 0)
}

const refused = (service: SandboxesService, token = TOKEN) =>
  service.verifyTokenPrincipal({ token }).then(
    () => false,
    () => true,
  )

const sessionOf = () => db.orm.public.Session.where({ id: `ses_${THREAD}` }).first()

const retire = async (): Promise<string> => {
  const session = await sessionOf()
  if (session === null) throw new Error('fixture session is missing')
  await db.orm.public.CloudSandbox.where({ sessionId: session.id }).update({
    retiredAt: new Date(),
    serveUrl: null,
  })
  await db.orm.public.Session.where({ id: session.id }).update({ deletedAt: new Date() })
  return session.id
}

describe('sandbox token revocation', () => {
  useTestDatabase()
  const services: SandboxesService[] = []

  const watch = (env?: EnvService): SandboxesService => {
    const service = newService(env)
    service.startPrincipalWatch()
    services.push(service)
    return service
  }

  afterEach(async () => {
    for (const service of services.splice(0)) await service.onModuleDestroy()
  })

  beforeEach(async () => {
    await seedUsers(USER_A)
    await seedThreadRow({ id: THREAD })
    await seedSandboxRow({ threadId: THREAD, tokenHash: hashSessionToken(TOKEN) })
  })

  it('answers a live sandbox token with its principal', async () => {
    await expect(newService().verifyTokenPrincipal({ token: TOKEN })).resolves.toEqual({
      kind: ETokenPrincipalKind.Sandbox,
      id: `sbx_${THREAD}`,
      threadId: THREAD,
      userId: USER_A,
    })
  })

  it('refuses the token of a retired sandbox', async () => {
    const sessionId = await retire()

    expect(sessionId).toBe(`ses_${THREAD}`)
    expect(await refused(newService())).toBe(true)
  })

  it('refuses the token of a soft-deleted session even before the sweep retires the row', async () => {
    await db.orm.public.Session.where({ id: `ses_${THREAD}` }).update({ deletedAt: new Date() })

    expect(await refused(newService())).toBe(true)
  })

  it('keeps the token of an archived session working, and again after unarchive', async () => {
    await db.orm.public.Session.where({ id: `ses_${THREAD}` }).update({
      archivedAt: new Date(),
    })
    await expect(newService().verifyTokenPrincipal({ token: TOKEN })).resolves.toMatchObject({
      kind: ETokenPrincipalKind.Sandbox,
    })

    await db.orm.public.Session.where({ id: `ses_${THREAD}` }).update({ archivedAt: null })
    await expect(newService().verifyTokenPrincipal({ token: TOKEN })).resolves.toMatchObject({
      id: `sbx_${THREAD}`,
    })
  })

  it('revives a retired sandbox with a fresh token and revokes the retired one', async () => {
    await retire()
    expect(await refused(newService())).toBe(true)

    const revived = await newService().claim({ userId: USER_A, threadId: THREAD })

    expect(revived.token).not.toBe(TOKEN)
    const row = await db.orm.public.CloudSandbox.where({ sessionId: `ses_${THREAD}` }).first()
    expect(row?.retiredAt).toBeNull()
    expect(row?.tokenHash).toBe(hashSessionToken(revived.token))
    expect((await sessionOf())?.deletedAt).toBeNull()
    expect(await refused(newService())).toBe(true)
    await expect(
      newService().verifyTokenPrincipal({ token: revived.token }),
    ).resolves.toMatchObject({ id: `sbx_${THREAD}` })
  })

  it('makes a second instance refuse a rotation the first one wrote, without waiting for the ttl', async () => {
    const first = watch()
    const second = watch()
    await expect(second.verifyTokenPrincipal({ token: TOKEN })).resolves.toMatchObject({
      id: `sbx_${THREAD}`,
    })

    await first.claim({ userId: USER_A, threadId: THREAD })

    await waitUntil(async () => refused(second), 5_000)
    expect(await refused(watch())).toBe(true)
  })

  it('listens on the database the env names, and starts no listener when it names none', async () => {
    watch(envWithoutDatabase())
    await Bun.sleep(200)
    expect(await openWatches()).toBe(0)

    watch()
    await waitUntil(async () => (await openWatches()) === 1, 5_000)
  })

  it('makes a second instance refuse a retirement written straight into the row, as the sweep does', async () => {
    const second = watch()
    await expect(second.verifyTokenPrincipal({ token: TOKEN })).resolves.toMatchObject({
      id: `sbx_${THREAD}`,
    })

    await notifyPrincipalRevoked(await retire())

    await waitUntil(async () => refused(second), 5_000)
  })
})

async function waitUntil(predicate: () => Promise<boolean>, boundMs: number): Promise<void> {
  const deadline = Date.now() + boundMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`condition still false after ${boundMs}ms`)
}
