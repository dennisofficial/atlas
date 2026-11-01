import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import {
  ECredentialAvailability,
  ECredentialFence,
  EAdmissionCompletion,
  EAvailabilityControl,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  type AdmissionDecision,
  type AdmissionPermit,
  type CredentialRevision,
} from '@dltech/atlas-wire'
import { beforeEach, describe, expect, it } from 'bun:test'
import { PROBE_LEASE_MS } from '@dltech/atlas-core'
import { CredentialAvailabilityService } from './credential-availability.service'

const USER_A = 'user-a'
const USER_B = 'user-b'
const KEY = {
  accountId: 'acc-1',
  providerId: 'anthropic',
  modelId: 'claude-x',
}
const REVISION: CredentialRevision = {
  fence: ECredentialFence.Replaced,
  value: 0,
}
const RESET_AT = '2099-01-01T00:00:00.000Z'

const failure = (overrides: { kind: EProviderFailureKind; resetAt?: string }) => ({
  kind: overrides.kind,
  scope: EProviderFailureScope.Credential,
  retry: EProviderRetry.Never,
  message: 'provider said no',
  ...(overrides.resetAt === undefined ? {} : { resetAt: overrides.resetAt }),
})

const failed = (kind: EProviderFailureKind, resetAt?: string) => ({
  outcome: EAdmissionCompletion.Failed as const,
  failure: failure({ kind, ...(resetAt === undefined ? {} : { resetAt }) }),
})

const permitOf = (decision: AdmissionDecision): AdmissionPermit => {
  if (!decision.admitted) throw new Error('expected an admitted decision')
  return decision.permit
}

describe('CredentialAvailabilityService', () => {
  const database = useTestDatabase()
  const service = new CredentialAvailabilityService()
  const input = { key: KEY, revision: REVISION }
  const row = () => db.orm.public.CredentialAvailability.first()
  const rows = () => db.orm.public.CredentialAvailability.all()

  beforeEach(async () => {
    for (const id of [USER_A, USER_B]) await seedUser({ db: database().db, id })
  })

  const close = async (kind: EProviderFailureKind, resetAt?: string): Promise<void> => {
    const permit = permitOf(await service.admit({ userId: USER_A, input }))
    await service.complete({
      userId: USER_A,
      permit,
      completion: failed(kind, resetAt),
    })
  }

  const expireProbe = () =>
    db.orm.public.CredentialAvailability.where((r) => r.id.neq('')).updateAndCount({
      probeExpiresAt: new Date(Date.now() - 1000),
    })

  it('admits an ordinary permit when nothing is recorded', async () => {
    const decision = await service.admit({ userId: USER_A, input })

    expect(decision.admitted).toBe(true)
    expect(permitOf(decision).probe).toBe(false)
    expect(permitOf(decision).permitId).toMatch(/^[0-9a-f-]{36}$/)
    expect(await rows()).toHaveLength(0)
  })

  it('records a quota barrier with the provider reset as cooldown until', async () => {
    await close(EProviderFailureKind.Quota, RESET_AT)

    const snapshot = await service.inspect({ userId: USER_A, input })
    expect(snapshot.availability).toBe(ECredentialAvailability.Cooldown)
    expect(snapshot.until).toBe(RESET_AT)
    expect((await row())?.until?.toISOString()).toBe(RESET_AT)
  })

  it('records quota without evidence as quota-exhausted and auth as auth-rejected', async () => {
    await close(EProviderFailureKind.Quota)
    expect((await service.inspect({ userId: USER_A, input })).availability).toBe(
      ECredentialAvailability.QuotaExhausted,
    )

    await service.control({
      userId: USER_A,
      input: { ...input, action: EAvailabilityControl.Pause },
    })
    await service.control({
      userId: USER_A,
      input: { ...input, action: EAvailabilityControl.Resume },
    })
    await close(EProviderFailureKind.Auth)
    expect((await service.inspect({ userId: USER_A, input })).availability).toBe(
      ECredentialAvailability.AuthRejected,
    )
  })

  it('blocks admission while the barrier is closed and the probe lease is held', async () => {
    await close(EProviderFailureKind.Quota)

    const probe = await service.admit({ userId: USER_A, input })
    expect(permitOf(probe).probe).toBe(true)
    const stored = await row()
    expect(stored?.probeId).toBe(permitOf(probe).permitId)
    expect(stored?.probeExpiresAt?.getTime()).toBeGreaterThan(Date.now() + PROBE_LEASE_MS - 5000)

    expect((await service.admit({ userId: USER_A, input })).admitted).toBe(false)
  })

  it('admits exactly one probe when two admits race on a closed barrier', async () => {
    await close(EProviderFailureKind.Quota)

    const decisions = await Promise.all(
      Array.from({ length: 16 }, () => service.admit({ userId: USER_A, input })),
    )

    const admitted = decisions.filter((decision) => decision.admitted)
    expect(admitted).toHaveLength(1)
    expect(permitOf(admitted[0] as AdmissionDecision).probe).toBe(true)
    expect(decisions.filter((decision) => !decision.admitted)).toHaveLength(15)
  })

  it('clears the barrier when the probe completes successfully', async () => {
    await close(EProviderFailureKind.Quota)
    const probe = permitOf(await service.admit({ userId: USER_A, input }))

    await service.complete({
      userId: USER_A,
      permit: probe,
      completion: { outcome: EAdmissionCompletion.Succeeded },
    })

    expect(await rows()).toHaveLength(0)
    expect(permitOf(await service.admit({ userId: USER_A, input })).probe).toBe(false)
  })

  it('re-blocks when a promoted probe later fails, and releases the lease', async () => {
    await close(EProviderFailureKind.Quota)
    const probe = permitOf(await service.admit({ userId: USER_A, input }))

    await service.promoteProbe({
      userId: USER_A,
      permit: probe,
      failure: failure({ kind: EProviderFailureKind.Quota, resetAt: RESET_AT }),
    })

    const stored = await row()
    expect(stored?.probeId).toBeNull()
    expect(stored?.availability).toBe(ECredentialAvailability.Cooldown)
    const next = permitOf(await service.admit({ userId: USER_A, input }))
    expect(next.probe).toBe(true)
    expect(next.permitId).not.toBe(probe.permitId)
    expect((await service.admit({ userId: USER_A, input })).admitted).toBe(false)
  })

  it('ignores a probe completion that names the wrong permit id', async () => {
    await close(EProviderFailureKind.Quota)
    const probe = permitOf(await service.admit({ userId: USER_A, input }))

    await service.complete({
      userId: USER_A,
      permit: { ...probe, permitId: 'forged' },
      completion: { outcome: EAdmissionCompletion.Succeeded },
    })

    expect((await row())?.probeId).toBe(probe.permitId)
    expect((await service.inspect({ userId: USER_A, input })).availability).not.toBe(
      ECredentialAvailability.Available,
    )
  })

  it('re-admits a probe once the lease has expired and fences the late completion', async () => {
    await close(EProviderFailureKind.Quota)
    const stale = permitOf(await service.admit({ userId: USER_A, input }))
    await expireProbe()

    const next = permitOf(await service.admit({ userId: USER_A, input }))
    expect(next.probe).toBe(true)
    expect(next.permitId).not.toBe(stale.permitId)

    await service.complete({
      userId: USER_A,
      permit: stale,
      completion: { outcome: EAdmissionCompletion.Succeeded },
    })
    expect((await row())?.probeId).toBe(next.permitId)
  })

  it('treats a non-probe failure during a probe as a barrier change that keeps the lease', async () => {
    const ordinary = permitOf(await service.admit({ userId: USER_A, input }))
    await close(EProviderFailureKind.Quota)
    const probe = permitOf(await service.admit({ userId: USER_A, input }))

    await service.complete({
      userId: USER_A,
      permit: ordinary,
      completion: failed(EProviderFailureKind.Auth),
    })

    const stored = await row()
    expect(stored?.availability).toBe(ECredentialAvailability.AuthRejected)
    expect(stored?.probeId).toBe(probe.permitId)
  })

  it('resets to available when the credential revision has moved on', async () => {
    await close(EProviderFailureKind.Quota)

    const replaced = { fence: ECredentialFence.Replaced, value: 1 }
    const decision = await service.admit({
      userId: USER_A,
      input: { key: KEY, revision: replaced },
    })

    expect(permitOf(decision).probe).toBe(false)
    expect(await rows()).toHaveLength(0)
  })

  it('admits again once a cooldown has lapsed without needing a probe', async () => {
    await close(EProviderFailureKind.Quota, RESET_AT)
    await db.orm.public.CredentialAvailability.where((r) => r.id.neq('')).updateAndCount({
      until: new Date(Date.now() - 1000),
    })

    expect(permitOf(await service.admit({ userId: USER_A, input })).probe).toBe(false)
  })

  it('round-trips pause and resume and blocks while paused', async () => {
    const paused = await service.control({
      userId: USER_A,
      input: { ...input, action: EAvailabilityControl.Pause },
    })
    expect(paused.availability).toBe(ECredentialAvailability.Paused)
    expect((await service.admit({ userId: USER_A, input })).admitted).toBe(false)

    const resumed = await service.control({
      userId: USER_A,
      input: { ...input, action: EAvailabilityControl.Resume },
    })
    expect(resumed.availability).toBe(ECredentialAvailability.Available)
    expect(await rows()).toHaveLength(0)
    expect(permitOf(await service.admit({ userId: USER_A, input })).probe).toBe(false)
  })

  it('does not let a success or failure complete overwrite a manual pause', async () => {
    const ordinary = permitOf(await service.admit({ userId: USER_A, input }))
    await service.control({
      userId: USER_A,
      input: { ...input, action: EAvailabilityControl.Pause },
    })

    await service.complete({
      userId: USER_A,
      permit: ordinary,
      completion: failed(EProviderFailureKind.Quota),
    })

    expect((await service.inspect({ userId: USER_A, input })).availability).toBe(
      ECredentialAvailability.Paused,
    )
  })

  it('scopes every barrier to the calling user', async () => {
    await close(EProviderFailureKind.Quota)

    expect(permitOf(await service.admit({ userId: USER_B, input })).probe).toBe(false)
    expect((await service.inspect({ userId: USER_B, input })).availability).toBe(
      ECredentialAvailability.Available,
    )
    expect((await service.admit({ userId: USER_A, input })).admitted).toBe(true)
  })

  it('keeps barriers per model', async () => {
    await close(EProviderFailureKind.Quota)

    const other = { key: { ...KEY, modelId: 'claude-y' }, revision: REVISION }
    expect(permitOf(await service.admit({ userId: USER_A, input: other })).probe).toBe(false)
  })
})
