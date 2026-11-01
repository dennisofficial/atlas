import { describe, expect, it } from 'bun:test'

import {
  EAdmissionCompletion,
  ECredentialAvailability,
  ECredentialFence,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  EAvailabilityControl,
  PROBE_LEASE_MS,
  toAccountId,
  type AvailabilityKey,
  type ClockPort,
  type CredentialRevision,
  type NormalizedProviderFailure,
} from '@dltech/atlas-core'

import { InMemoryCredentialAvailability } from '../credential-availability'

const START_MS = Date.parse('2026-11-01T12:00:00.000Z')

const steppedClock = (): ClockPort & { advance: (ms: number) => void } => {
  let nowMs = START_MS
  return {
    now: () => new Date(nowMs).toISOString(),
    advance: (ms) => {
      nowMs += ms
    },
  }
}

const key: AvailabilityKey = {
  accountId: toAccountId('acct_1'),
  providerId: 'anthropic',
  modelId: 'claude-opus-5',
}
const revision: CredentialRevision = { fence: ECredentialFence.Replaced, value: 1 }

const quota = (resetAt?: string): NormalizedProviderFailure => ({
  kind: EProviderFailureKind.Quota,
  scope: EProviderFailureScope.Credential,
  retry: EProviderRetry.Never,
  message: 'out of quota',
  ...(resetAt === undefined ? {} : { resetAt }),
})

const permitOf = async (authority: InMemoryCredentialAvailability) => {
  const decision = await authority.admit({ key, revision })
  if (!decision.admitted) throw new Error('expected admission')
  return decision.permit
}

const setup = () => {
  const clock = steppedClock()
  return { clock, authority: new InMemoryCredentialAvailability({ clock }) }
}

describe('InMemoryCredentialAvailability', () => {
  it('admits an unknown key as an ordinary call', async () => {
    const { authority } = setup()

    expect(await permitOf(authority)).toMatchObject({ probe: false, key, revision })
  })

  it('closes the barrier on a credential-scoped failure and blocks the next admit with the probe in flight', async () => {
    const { authority } = setup()
    const first = await permitOf(authority)
    await authority.complete({
      permit: first,
      completion: { outcome: EAdmissionCompletion.Failed, failure: quota() },
    })

    const probe = await permitOf(authority)
    expect(probe.probe).toBe(true)

    const blocked = await authority.admit({ key, revision })
    expect(blocked).toMatchObject({
      admitted: false,
      block: { snapshot: { availability: ECredentialAvailability.QuotaExhausted } },
    })
  })

  it('records a cooldown from provider reset evidence and lapses it by the clock', async () => {
    const { authority, clock } = setup()
    const resetAt = new Date(START_MS + 60_000).toISOString()
    await authority.complete({
      permit: await permitOf(authority),
      completion: { outcome: EAdmissionCompletion.Failed, failure: quota(resetAt) },
    })

    expect(await authority.inspect({ key, revision })).toMatchObject({
      availability: ECredentialAvailability.Cooldown,
      until: resetAt,
    })

    clock.advance(60_001)
    expect((await authority.inspect({ key, revision })).availability).toBe(
      ECredentialAvailability.Available,
    )
  })

  it('re-opens probe admission when a probe lease expires without completion', async () => {
    const { authority, clock } = setup()
    await authority.complete({
      permit: await permitOf(authority),
      completion: { outcome: EAdmissionCompletion.Failed, failure: quota() },
    })
    await permitOf(authority)
    expect((await authority.admit({ key, revision })).admitted).toBe(false)

    clock.advance(PROBE_LEASE_MS + 1)

    const reopened = await authority.admit({ key, revision })
    expect(reopened).toMatchObject({ admitted: true, permit: { probe: true } })
  })

  it('clears the barrier when a probe succeeds', async () => {
    const { authority } = setup()
    await authority.complete({
      permit: await permitOf(authority),
      completion: { outcome: EAdmissionCompletion.Failed, failure: quota() },
    })
    const probe = await permitOf(authority)

    await authority.complete({
      permit: probe,
      completion: { outcome: EAdmissionCompletion.Succeeded },
    })

    expect((await authority.admit({ key, revision })).admitted).toBe(true)
    expect((await authority.inspect({ key, revision })).availability).toBe(
      ECredentialAvailability.Available,
    )
  })

  it('re-closes the barrier when a probe is promoted with a failure', async () => {
    const { authority } = setup()
    const probe = await (async () => {
      await authority.complete({
        permit: await permitOf(authority),
        completion: { outcome: EAdmissionCompletion.Failed, failure: quota() },
      })
      return permitOf(authority)
    })()

    await authority.promoteProbe({ permit: probe, failure: quota() })

    expect(await authority.admit({ key, revision })).toMatchObject({
      admitted: true,
      permit: { probe: true },
    })
  })

  it('treats a changed revision as a fresh, available credential', async () => {
    const { authority } = setup()
    await authority.complete({
      permit: await permitOf(authority),
      completion: { outcome: EAdmissionCompletion.Failed, failure: quota() },
    })

    const replaced = { fence: ECredentialFence.Replaced, value: 2 }
    expect(await authority.admit({ key, revision: replaced })).toMatchObject({
      admitted: true,
      permit: { probe: false },
    })
  })

  it('keeps keys independent per account, provider and model', async () => {
    const { authority } = setup()
    await authority.complete({
      permit: await permitOf(authority),
      completion: { outcome: EAdmissionCompletion.Failed, failure: quota() },
    })

    const otherModel = { ...key, modelId: 'claude-haiku-5' }
    expect(await authority.admit({ key: otherModel, revision })).toMatchObject({
      admitted: true,
      permit: { probe: false },
    })
  })

  it('pauses and resumes on operator control, never admitting a probe while paused', async () => {
    const { authority } = setup()

    const paused = await authority.control({ key, revision, action: EAvailabilityControl.Pause })
    expect(paused.availability).toBe(ECredentialAvailability.Paused)
    expect((await authority.admit({ key, revision })).admitted).toBe(false)

    const resumed = await authority.control({ key, revision, action: EAvailabilityControl.Resume })
    expect(resumed.availability).toBe(ECredentialAvailability.Available)
    expect((await authority.admit({ key, revision })).admitted).toBe(true)
  })
})
