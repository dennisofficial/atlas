import { afterEach, describe, expect, it, setSystemTime } from 'bun:test'
import { LocalObservationAdapter } from './github-observation.local'
import { EGithubHttpCategory, type ObservationLease } from './github-observation.types'

const lease = (id: number): ObservationLease => ({
  id: `local-${id}`,
  userId: `user-${id}`,
  keys: [{ repoFullName: 'compai/app', prNumber: 42 }],
  credentialFingerprint: `credential-${id}`,
  authorizedUntil: { 'compai/app': Date.now() + 120_000 },
  expiresAt: Date.now() + 120_000,
})

describe('same-process observation adapter', () => {
  afterEach(() => setSystemTime())
  it('returns complete filtered recipient sets but samples bounded worker batches', async () => {
    const adapter = new LocalObservationAdapter()
    for (let index = 0; index < 140; index += 1) await adapter.write(lease(index))
    expect(await adapter.entries({ repoFullName: 'compai/app', prNumber: 42 })).toHaveLength(140)
    expect(await adapter.entries({ repoFullName: 'compai/app' })).toHaveLength(140)
    expect(await adapter.entries()).toHaveLength(128)
  })
  it('isolates provider cooldowns by credential and resource without splitting the global HTTP allowance', async () => {
    const adapter = new LocalObservationAdapter()
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
    const adapter = new LocalObservationAdapter()
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
  it('shares versioned grants and denials without allowing an older success to overwrite denial', async () => {
    const adapter = new LocalObservationAdapter()
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
    const adapter = new LocalObservationAdapter()
    await adapter.recordAttempt({ key: 'compai/app#42', failed: true })
    expect((await adapter.attempt('compai/app#42')).failures).toBe(1)
    setSystemTime(new Date(Date.now() + 1_200_001))
    expect(await adapter.attempt('compai/app#42')).toEqual({ nextAttemptAt: 0, failures: 0 })
  })
})
