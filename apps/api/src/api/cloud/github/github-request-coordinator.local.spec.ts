import { afterEach, describe, expect, it, setSystemTime } from 'bun:test'
import { localCoordinator } from './github-request-coordinator.fixture'
import { LocalCoordinatorAdapter } from './github-request-coordinator.local'
import { EGithubHttpCategory } from './github-request-coordinator.types'
import type { GithubService } from './github.service'

describe('same-process request coordinator adapter', () => {
  afterEach(() => setSystemTime())
  it('isolates provider cooldowns by credential and resource without splitting the global HTTP allowance', async () => {
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
    for (let index = 0; index < 58; index += 1) expect(await adapter.takeHttpSlot()).toBe(true)
    expect(await adapter.takeHttpSlot()).toBe(false)
  })
  it('preserves reserved authorization/refresh capacity inside one global request allowance', async () => {
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
    expect(await adapter.takeHttpSlot()).toBe(false)
  })
  it('does not let an older in-flight success overwrite a newer denial', async () => {
    const adapter = new LocalCoordinatorAdapter()
    const first = await adapter.beginAuthorization('user:repo:fingerprint')
    const grant = {
      version: first,
      checkedAt: Date.now(),
      authorizedUntil: Date.now() + 120_000,
      deniedUntil: 0,
    }
    await adapter.writeAuthorization({ key: 'user:repo:fingerprint', state: grant })
    const second = await adapter.beginAuthorization('user:repo:fingerprint')
    const denial = {
      version: second,
      checkedAt: Date.now(),
      authorizedUntil: 0,
      deniedUntil: Date.now() + 120_000,
    }
    await adapter.writeAuthorization({ key: 'user:repo:fingerprint', state: denial })
    expect(
      await adapter.writeAuthorization({ key: 'user:repo:fingerprint', state: grant }),
    ).toEqual(denial)
    expect(await adapter.readAuthorization('user:repo:fingerprint')).toEqual(denial)
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
})
