import { afterEach, describe, expect, it, setSystemTime } from 'bun:test'
import { credentialFingerprint } from './github-request-budget'
import { localCoordinator } from './github-request-coordinator.fixture'
import { LocalCoordinatorAdapter } from './github-request-coordinator.local'
import { ACCESS_PROOF_DENIAL_TTL_MS, EGithubHttpCategory } from './github-request-coordinator.types'
import type { GithubService } from './github.service'

describe('same-process request coordinator adapter', () => {
  afterEach(() => setSystemTime())
  it('isolates provider cooldowns and per-minute windows by credential and resource', async () => {
    const adapter = new LocalCoordinatorAdapter()
    const identity = { credentialFingerprint: 'one', resource: 'core' }
    await adapter.blockHttpUntil({ ...identity, until: Date.now() + 3_600_000 })
    expect(await adapter.takeHttpSlot(identity)).toBe(false)
    expect(await adapter.takeHttpSlot({ credentialFingerprint: 'two', resource: 'core' })).toBe(
      true,
    )
    expect(await adapter.takeHttpSlot({ credentialFingerprint: 'one', resource: 'search' })).toBe(
      true,
    )
    const paced = { credentialFingerprint: 'three', resource: 'core' }
    for (let index = 0; index < 60; index += 1) expect(await adapter.takeHttpSlot(paced)).toBe(true)
    expect(await adapter.takeHttpSlot(paced)).toBe(false)
    expect(await adapter.takeHttpSlot({ credentialFingerprint: 'four', resource: 'core' })).toBe(
      true,
    )
  })
  it('preserves reserved authorization/refresh capacity inside one credential’s allowance', async () => {
    const adapter = new LocalCoordinatorAdapter()
    const identity = { credentialFingerprint: 'one', resource: 'core' }
    for (let index = 0; index < 12; index += 1)
      expect(
        await adapter.takeHttpSlot({ ...identity, category: EGithubHttpCategory.Authorization }),
      ).toBe(true)
    expect(
      await adapter.takeHttpSlot({ ...identity, category: EGithubHttpCategory.Authorization }),
    ).toBe(false)
    for (let index = 0; index < 48; index += 1)
      expect(
        await adapter.takeHttpSlot({ ...identity, category: EGithubHttpCategory.Refresh }),
      ).toBe(true)
    expect(await adapter.takeHttpSlot(identity)).toBe(false)
  })
  it('holds a low-quota reserve per credential and resource until it expires', async () => {
    const adapter = new LocalCoordinatorAdapter()
    const identity = { credentialFingerprint: 'one', resource: 'core' }
    const until = Date.now() + 90_000
    await adapter.holdHttpReserve({ ...identity, until })
    await adapter.holdHttpReserve({ ...identity, until: until - 30_000 })
    expect(await adapter.httpReserveUntil(identity)).toBe(until)
    expect(await adapter.httpReserveUntil({ credentialFingerprint: 'two', resource: 'core' })).toBe(
      0,
    )
  })
  it('does not let an older in-flight success overwrite a newer denial', async () => {
    const adapter = new LocalCoordinatorAdapter()
    const first = await adapter.beginAuthorization('fingerprint:compai/app')
    const grant = {
      version: first,
      checkedAt: Date.now(),
      granted: true,
      deniedUntil: 0,
    }
    await adapter.writeAuthorization({ key: 'fingerprint:compai/app', state: grant })
    const second = await adapter.beginAuthorization('fingerprint:compai/app')
    const denial = {
      version: second,
      checkedAt: Date.now(),
      granted: false,
      deniedUntil: Date.now() + 120_000,
    }
    await adapter.writeAuthorization({ key: 'fingerprint:compai/app', state: denial })
    expect(
      await adapter.writeAuthorization({ key: 'fingerprint:compai/app', state: grant }),
    ).toEqual(denial)
    expect(await adapter.readAuthorization('fingerprint:compai/app')).toEqual(denial)
  })
  it('expires retry attempts after twenty minutes', async () => {
    const adapter = new LocalCoordinatorAdapter()
    await adapter.recordAttempt({ key: 'compai/app#42', failed: true })
    expect((await adapter.attempt('compai/app#42')).failures).toBe(1)
    setSystemTime(new Date(Date.now() + 1_200_001))
    expect(await adapter.attempt('compai/app#42')).toEqual({ nextAttemptAt: 0, failures: 0 })
  })
})

describe('request coordinator access proofs', () => {
  const github = { findToken: async () => 'token' } as unknown as GithubService
  afterEach(() => setSystemTime())

  it('flips proven access off on a denial and back on a later recordAccess', async () => {
    const coordinator = localCoordinator(github)
    const repo = { userId: 'usr_1', repoFullName: 'compai/app' }
    await coordinator.recordDenial({ ...repo, message: 'no access' })
    expect(await coordinator.deniedAccess(repo)).toBe(true)
    expect(await coordinator.provenAccess(repo)).toBe(false)
    await coordinator.recordAccess(repo)
    expect(await coordinator.deniedAccess(repo)).toBe(false)
    expect(await coordinator.provenAccess(repo)).toBe(true)
  })

  it('keeps a grant with no expiry and a denial for thirty seconds', async () => {
    const coordinator = localCoordinator(github)
    const repo = { userId: 'usr_1', repoFullName: 'compai/app' }

    await coordinator.recordAccess(repo)
    setSystemTime(new Date(Date.now() + 365 * 24 * 3_600_000))
    expect(await coordinator.provenAccess(repo)).toBe(true)

    await coordinator.recordDenial({ ...repo, message: 'no access' })
    setSystemTime(new Date(Date.now() + ACCESS_PROOF_DENIAL_TTL_MS - 1))
    expect(await coordinator.deniedAccess(repo)).toBe(true)
    setSystemTime(new Date(Date.now() + 1))
    expect(await coordinator.deniedAccess(repo)).toBe(false)
  })

  it('drops one repository grant on a repo signal and every grant on a token signal', async () => {
    const coordinator = localCoordinator(github)
    const fingerprint = credentialFingerprint('token')
    const app = { userId: 'usr_1', repoFullName: 'compai/app' }
    const other = { userId: 'usr_1', repoFullName: 'compai/other' }
    await coordinator.recordAccess(app)
    await coordinator.recordAccess(other)

    await coordinator.revokeAccessGrant({
      credentialFingerprint: fingerprint,
      repoFullName: 'CompAI/App',
    })
    expect(await coordinator.provenAccess(app)).toBe(false)
    expect(await coordinator.provenAccess(other)).toBe(true)

    await coordinator.revokeAccessGrant({ credentialFingerprint: fingerprint })
    expect(await coordinator.provenAccess(other)).toBe(false)
  })
})
