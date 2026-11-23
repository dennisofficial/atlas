import { createPublicKey, createVerify } from 'node:crypto'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { db } from '@dltech/atlas-db'
import { ensureUsers } from './testing/github-seed'
import {
  fakeGithubApp,
  syncServiceWith,
  TEST_APP_PUBLIC_KEY,
  type FakeInstallation,
} from './github-app-sync.fixture'

const PERSONAL: FakeInstallation = {
  id: 145998843,
  login: 'dennisofficial',
  repos: ['DennisOfficial/Atlas'],
}
const HOUR_MS = 60 * 60 * 1_000

const seedTarget = (args: { repoFullName: string; nextDueAt: Date }) =>
  db.orm.public.GithubTrackingTarget.create({
    userId: 'usr_1',
    kind: 'head',
    repoFullName: args.repoFullName,
    branch: 'dennis/feature',
    prNumber: 0,
    lookedUpAt: null,
    attemptedAt: null,
    failures: 0,
    leaseUntil: null,
    nextDueAt: args.nextDueAt,
    liveUntil: new Date(args.nextDueAt.getTime() + HOUR_MS),
  })

const dueAt = (id: string) => db.orm.public.GithubTrackingTarget.first({ id })

let github: ReturnType<typeof fakeGithubApp> | undefined

afterEach(() => github?.restore())

describe('GithubAppSyncService', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr_1')
  })

  it('inserts a missing installation with all its repos, paging past 100', async () => {
    const many = Array.from({ length: 130 }, (_, index) => `dennisofficial/repo-${index}`)
    github = fakeGithubApp({
      installations: [{ ...PERSONAL, repos: [...many, 'DennisOfficial/Atlas'] }],
    })
    const { service, installations } = syncServiceWith()

    await service.syncFromGithub()

    expect(await installations.heldRepos({ installationId: 145998843n })).toHaveLength(131)
    expect(await installations.coversRepo({ repoFullName: 'dennisofficial/atlas' })).toBe(true)
  })

  it('updates repos, marks suspended and removes an installation GitHub no longer lists', async () => {
    github = fakeGithubApp({
      installations: [PERSONAL, { id: 7, login: 'gone', repos: ['gone/x'] }],
    })
    const { service, installations } = syncServiceWith()
    await service.syncFromGithub()
    expect(await installations.coversRepo({ repoFullName: 'gone/x' })).toBe(true)

    github.state.installations = [{ ...PERSONAL, repos: ['dennisofficial/other'] }]
    await service.syncFromGithub()
    expect(await installations.coversRepo({ repoFullName: 'gone/x' })).toBe(false)
    expect(await installations.coversRepo({ repoFullName: 'dennisofficial/atlas' })).toBe(false)
    expect(await installations.coversRepo({ repoFullName: 'dennisofficial/other' })).toBe(true)

    github.state.installations = [{ ...PERSONAL, repos: ['dennisofficial/other'], suspended: true }]
    await service.syncFromGithub()
    const row = await db.orm.public.GithubAppInstallation.first({
      installationId: 145998843n,
    })
    expect(row?.suspendedAt).not.toBeNull()
    expect(await installations.coversRepo({ repoFullName: 'dennisofficial/other' })).toBe(false)
  })

  it('makes the targets of a repo a sync drops from an installation due', async () => {
    github = fakeGithubApp({
      installations: [{ ...PERSONAL, repos: ['DennisOfficial/Atlas', 'DennisOfficial/legacy'] }],
    })
    const { service } = syncServiceWith()
    await service.syncFromGithub()
    const dropped = await seedTarget({
      repoFullName: 'dennisofficial/legacy',
      nextDueAt: new Date(Date.now() + HOUR_MS),
    })
    const stable = await seedTarget({
      repoFullName: 'dennisofficial/atlas',
      nextDueAt: new Date(Date.now() + HOUR_MS),
    })

    github.state.installations = [PERSONAL]
    await service.syncFromGithub()

    expect((await dueAt(dropped.id))?.nextDueAt.getTime()).toBeLessThanOrEqual(Date.now())
    expect((await dueAt(stable.id))?.nextDueAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('makes the targets of a repo an unsuspended installation gains due', async () => {
    github = fakeGithubApp({
      installations: [{ ...PERSONAL, suspended: true, repos: ['DennisOfficial/Atlas'] }],
    })
    const { service } = syncServiceWith()
    await service.syncFromGithub()
    const target = await seedTarget({
      repoFullName: 'dennisofficial/atlas',
      nextDueAt: new Date(Date.now() + HOUR_MS),
    })

    github.state.installations = [PERSONAL]
    await service.syncFromGithub()

    expect((await dueAt(target.id))?.nextDueAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('syncs once for an unknown installation id and debounces repeats', async () => {
    github = fakeGithubApp({ installations: [PERSONAL] })
    const { service } = syncServiceWith()

    await service.syncUnknownInstallation({ installationId: 999 })
    await service.syncUnknownInstallation({ installationId: 999 })

    expect(github.calls.filter((call) => call === 'GET /app/installations')).toHaveLength(1)
  })

  it('does not sync for an installation it already holds', async () => {
    github = fakeGithubApp({ installations: [PERSONAL] })
    const { service } = syncServiceWith()
    await service.syncFromGithub()
    github.calls.length = 0

    await service.syncUnknownInstallation({ installationId: 145998843 })

    expect(github.calls).toEqual([])
  })

  it('checks a known installation against the process set instead of the table', async () => {
    github = fakeGithubApp({ installations: [PERSONAL] })
    const { service } = syncServiceWith()
    await service.syncFromGithub()
    const select = spyOn(db.orm.public.GithubAppInstallation, 'select')
    try {
      await service.syncUnknownInstallation({ installationId: 145998843 })
      expect(select).not.toHaveBeenCalled()
    } finally {
      select.mockRestore()
    }
  })

  it('drops a deleted installation from the known set so the next delivery reads it', async () => {
    github = fakeGithubApp({ installations: [PERSONAL] })
    const { service, installations } = syncServiceWith()
    await service.syncFromGithub()
    await installations.applyInstallation({
      action: 'deleted',
      installation: {
        id: PERSONAL.id,
        account: { login: 'dennisofficial', type: 'User' },
        suspended_at: null,
      },
    } as never)

    expect(await installations.isKnown({ installationId: BigInt(PERSONAL.id) })).toBe(false)
  })

  it('throttles the periodic sync to once per window', async () => {
    github = fakeGithubApp({ installations: [PERSONAL] })
    const { service } = syncServiceWith()

    await service.syncIfDue()
    await service.syncIfDue()

    expect(github.calls.filter((call) => call === 'GET /app/installations')).toHaveLength(1)
  })

  it('signs an RS256 JWT with the app id as iss and a 10 minute ceiling', () => {
    const { client } = syncServiceWith()
    const jwt = client.signJwt({ nowSeconds: 1_000_000 })
    const [header, payload, signature] = jwt.split('.') as [string, string, string]

    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    })
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
      iat: 999_940,
      exp: 1_000_540,
      iss: '4242',
    })
    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(createPublicKey(TEST_APP_PUBLIC_KEY), Buffer.from(signature, 'base64url'))
    expect(verified).toBe(true)
  })
})
