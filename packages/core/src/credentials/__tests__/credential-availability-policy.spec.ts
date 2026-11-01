import { describe, expect, it } from 'bun:test'

import {
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  type NormalizedProviderFailure,
} from '../../models/provider-failure'
import { toAccountId } from '../account'
import {
  EAdmissionCompletion,
  EAvailabilityControl,
  ECredentialAvailability,
  ECredentialFence,
  type AdmissionPermit,
  type AvailabilityKey,
  type CredentialRevision,
} from '../credential-availability'
import {
  PROBE_LEASE_MS,
  admitState,
  completeState,
  controlState,
  inspectState,
  promoteProbeState,
  type AvailabilityState,
} from '../credential-availability-policy'

const key: AvailabilityKey = {
  accountId: toAccountId('acct_1'),
  providerId: 'anthropic',
  modelId: 'claude-opus',
}
const revision: CredentialRevision = { fence: ECredentialFence.Replaced, value: 1 }
const T0 = Date.parse('2026-11-01T00:00:00.000Z')
const iso = (ms: number): string => new Date(ms).toISOString()

const failure = (
  overrides: Partial<NormalizedProviderFailure> & Pick<NormalizedProviderFailure, 'kind' | 'scope'>,
): NormalizedProviderFailure => ({
  retry: EProviderRetry.Never,
  message: 'provider said no',
  ...overrides,
})

const QUOTA = failure({
  kind: EProviderFailureKind.Quota,
  scope: EProviderFailureScope.Credential,
})

const closedState = (
  availability: ECredentialAvailability,
  overrides: Partial<AvailabilityState['snapshot']> = {},
): AvailabilityState => ({
  snapshot: { key, availability, revision, since: iso(T0), ...overrides },
})

const inspectAt = (args: {
  state: AvailabilityState | undefined
  nowMs?: number
  rev?: CredentialRevision
}) =>
  inspectState({
    state: args.state,
    key,
    revision: args.rev ?? revision,
    nowMs: args.nowMs ?? T0,
    nowIso: iso(args.nowMs ?? T0),
  })

const admitAt = (args: {
  state: AvailabilityState | undefined
  nowMs?: number
  rev?: CredentialRevision
}) =>
  admitState({
    state: args.state,
    key,
    revision: args.rev ?? revision,
    nowMs: args.nowMs ?? T0,
    nowIso: iso(args.nowMs ?? T0),
  })

const permitOf = (args: { probe: boolean; nowMs?: number }): AdmissionPermit => ({
  key,
  revision,
  probe: args.probe,
  admittedAt: iso(args.nowMs ?? T0),
})

const failedWith = (args: {
  state: AvailabilityState | undefined
  failure: NormalizedProviderFailure
  permit?: AdmissionPermit
}) =>
  completeState({
    state: args.state,
    permit: args.permit ?? permitOf({ probe: false }),
    completion: { outcome: EAdmissionCompletion.Failed, failure: args.failure },
    nowIso: iso(T0 + 1_000),
  })

describe('admission on an open barrier', () => {
  it('admits a missing state without a probe and records nothing', () => {
    const { decision, next } = admitAt({ state: undefined })

    expect(decision).toEqual({ admitted: true, permit: permitOf({ probe: false }) })
    expect(next).toBeUndefined()
  })

  it('inspects a missing state as available at the asked revision', () => {
    const snapshot = inspectAt({ state: undefined })

    expect(snapshot.availability).toBe(ECredentialAvailability.Available)
    expect(snapshot.revision).toEqual(revision)
    expect(snapshot.key).toEqual(key)
  })
})

describe('admission on a closed barrier', () => {
  it('admits exactly one recovery probe and blocks the rest', () => {
    const state = closedState(ECredentialAvailability.QuotaExhausted)

    const first = admitAt({ state })
    expect(first.decision.admitted).toBe(true)
    if (!first.decision.admitted) return
    expect(first.decision.permit.probe).toBe(true)
    expect(first.next?.probe?.leasedUntilMs).toBe(T0 + PROBE_LEASE_MS)

    const second = admitAt({ state: first.next, nowMs: T0 + 1_000 })
    expect(second.decision.admitted).toBe(false)
    if (second.decision.admitted) return
    expect(second.decision.block.snapshot.availability).toBe(ECredentialAvailability.QuotaExhausted)
  })

  it('re-admits a probe once the lease expires without completion', () => {
    const first = admitAt({ state: closedState(ECredentialAvailability.AuthRejected) })

    const beforeExpiry = admitAt({ state: first.next, nowMs: T0 + PROBE_LEASE_MS - 1 })
    expect(beforeExpiry.decision.admitted).toBe(false)

    const afterExpiry = admitAt({ state: first.next, nowMs: T0 + PROBE_LEASE_MS })
    expect(afterExpiry.decision.admitted).toBe(true)
    if (!afterExpiry.decision.admitted) return
    expect(afterExpiry.decision.permit.probe).toBe(true)
    expect(afterExpiry.next?.probe?.leasedUntilMs).toBe(T0 + 2 * PROBE_LEASE_MS)
  })

  it('treats a lapsed cooldown as available', () => {
    const until = iso(T0 + 60_000)
    const state = closedState(ECredentialAvailability.Cooldown, { until })

    expect(inspectAt({ state, nowMs: T0 + 59_999 }).availability).toBe(
      ECredentialAvailability.Cooldown,
    )
    expect(inspectAt({ state, nowMs: T0 + 60_000 }).availability).toBe(
      ECredentialAvailability.Available,
    )
    const lapsed = admitAt({ state, nowMs: T0 + 60_000 })
    expect(lapsed.decision.admitted && !lapsed.decision.permit.probe).toBe(true)
  })

  it('resets to available when the revision differs in value or fence', () => {
    const state = closedState(ECredentialAvailability.AuthRejected)

    const bumped = inspectAt({ state, rev: { fence: ECredentialFence.Replaced, value: 2 } })
    const refenced = inspectAt({ state, rev: { fence: ECredentialFence.Refreshed, value: 1 } })

    expect(bumped.availability).toBe(ECredentialAvailability.Available)
    expect(refenced.availability).toBe(ECredentialAvailability.Available)
    expect(
      admitAt({ state, rev: { fence: ECredentialFence.Replaced, value: 2 } }).next,
    ).toBeUndefined()
  })
})

describe('failure to barrier mapping', () => {
  it.each([
    [
      'quota with reset evidence',
      failure({
        kind: EProviderFailureKind.Quota,
        scope: EProviderFailureScope.Credential,
        resetAt: iso(T0 + 3_600_000),
      }),
      ECredentialAvailability.Cooldown,
      iso(T0 + 3_600_000),
    ],
    [
      'quota with retry evidence only',
      failure({
        kind: EProviderFailureKind.Quota,
        scope: EProviderFailureScope.Credential,
        retryAt: iso(T0 + 5_000),
      }),
      ECredentialAvailability.Cooldown,
      iso(T0 + 5_000),
    ],
    ['quota without evidence', QUOTA, ECredentialAvailability.QuotaExhausted, undefined],
    [
      'auth',
      failure({ kind: EProviderFailureKind.Auth, scope: EProviderFailureScope.Credential }),
      ECredentialAvailability.AuthRejected,
      undefined,
    ],
    [
      'delivery',
      failure({ kind: EProviderFailureKind.Delivery, scope: EProviderFailureScope.Request }),
      ECredentialAvailability.DeliveryFault,
      undefined,
    ],
    [
      'model denied',
      failure({ kind: EProviderFailureKind.ModelDenied, scope: EProviderFailureScope.Route }),
      ECredentialAvailability.ModelDenied,
      undefined,
    ],
  ])('%s', (_name, input, availability, until) => {
    const next = failedWith({ state: undefined, failure: input })

    expect(next?.snapshot.availability).toBe(availability)
    expect(next?.snapshot.until).toBe(until)
    expect(next?.snapshot.reason).toBe('provider said no')
    expect(next?.snapshot.revision).toEqual(revision)
  })

  it('ignores an unparseable reset instant and stays unknown', () => {
    const next = failedWith({
      state: undefined,
      failure: failure({
        kind: EProviderFailureKind.Quota,
        scope: EProviderFailureScope.Credential,
        resetAt: 'soon',
      }),
    })

    expect(next?.snapshot.availability).toBe(ECredentialAvailability.QuotaExhausted)
    expect(next?.snapshot.until).toBeUndefined()
  })

  it.each([
    EProviderFailureKind.RateLimited,
    EProviderFailureKind.Network,
    EProviderFailureKind.Overloaded,
    EProviderFailureKind.Stalled,
    EProviderFailureKind.ContextOverflow,
    EProviderFailureKind.InvalidRequest,
    EProviderFailureKind.Cancelled,
    EProviderFailureKind.Other,
  ])('leaves the barrier open for %s', (kind) => {
    const transient = failure({ kind, scope: EProviderFailureScope.Route })

    expect(failedWith({ state: undefined, failure: transient })).toBeUndefined()

    const closed = closedState(ECredentialAvailability.QuotaExhausted)
    expect(failedWith({ state: closed, failure: transient })).toEqual(closed)
  })

  it('keeps the original since when the same barrier is re-recorded', () => {
    const state = closedState(ECredentialAvailability.QuotaExhausted)

    expect(failedWith({ state, failure: QUOTA })?.snapshot.since).toBe(iso(T0))
  })
})

describe('completion', () => {
  it('clears the barrier and the probe on success', () => {
    const admitted = admitAt({ state: closedState(ECredentialAvailability.QuotaExhausted) })
    if (!admitted.decision.admitted) throw new Error('expected a probe permit')

    const next = completeState({
      state: admitted.next,
      permit: admitted.decision.permit,
      completion: { outcome: EAdmissionCompletion.Succeeded },
      nowIso: iso(T0 + 1_000),
    })

    expect(next).toBeUndefined()
  })

  it('clears only the probe flag on cancel', () => {
    const state = closedState(ECredentialAvailability.AuthRejected)
    const admitted = admitAt({ state })
    if (!admitted.decision.admitted) throw new Error('expected a probe permit')

    const next = completeState({
      state: admitted.next,
      permit: admitted.decision.permit,
      completion: { outcome: EAdmissionCompletion.Cancelled },
      nowIso: iso(T0 + 1_000),
    })

    expect(next).toEqual(state)
    expect(admitAt({ state: next, nowMs: T0 + 1_000 }).decision.admitted).toBe(true)
  })

  it('records a failed probe and lets a later admit probe again', () => {
    const admitted = admitAt({ state: closedState(ECredentialAvailability.QuotaExhausted) })
    if (!admitted.decision.admitted) throw new Error('expected a probe permit')

    const next = failedWith({
      state: admitted.next,
      permit: admitted.decision.permit,
      failure: failure({
        kind: EProviderFailureKind.Auth,
        scope: EProviderFailureScope.Credential,
      }),
    })

    expect(next?.snapshot.availability).toBe(ECredentialAvailability.AuthRejected)
    expect(next?.probe).toBeUndefined()
    expect(admitAt({ state: next, nowMs: T0 + 2_000 }).decision.admitted).toBe(true)
  })

  it('keeps another permit probe in flight when a non-probe call fails', () => {
    const admitted = admitAt({ state: closedState(ECredentialAvailability.QuotaExhausted) })

    const next = failedWith({ state: admitted.next, failure: QUOTA })

    expect(next?.probe).toEqual(admitted.next?.probe)
  })

  it('opens the barrier from an open state on a credential failure', () => {
    const next = failedWith({ state: undefined, failure: QUOTA })

    expect(next?.snapshot.availability).toBe(ECredentialAvailability.QuotaExhausted)
    expect(next?.snapshot.since).toBe(iso(T0 + 1_000))
  })
})

describe('promoteProbe', () => {
  it('reclassifies a failed probe and clears the probe flag', () => {
    const admitted = admitAt({ state: closedState(ECredentialAvailability.QuotaExhausted) })
    if (!admitted.decision.admitted) throw new Error('expected a probe permit')

    const next = promoteProbeState({
      state: admitted.next,
      permit: admitted.decision.permit,
      failure: failure({
        kind: EProviderFailureKind.Quota,
        scope: EProviderFailureScope.Credential,
        resetAt: iso(T0 + 90_000),
      }),
      nowIso: iso(T0 + 1_000),
    })

    expect(next?.snapshot.availability).toBe(ECredentialAvailability.Cooldown)
    expect(next?.snapshot.until).toBe(iso(T0 + 90_000))
    expect(next?.probe).toBeUndefined()
  })

  it('opens the barrier when a first-output probe fails afterwards on an open state', () => {
    const next = promoteProbeState({
      state: undefined,
      permit: permitOf({ probe: true }),
      failure: QUOTA,
      nowIso: iso(T0 + 1_000),
    })

    expect(next?.snapshot.availability).toBe(ECredentialAvailability.QuotaExhausted)
  })
})

describe('stale permits', () => {
  const state = closedState(ECredentialAvailability.QuotaExhausted)
  const stale: AdmissionPermit = {
    ...permitOf({ probe: true }),
    revision: { fence: ECredentialFence.Replaced, value: 0 },
  }

  it.each([
    { outcome: EAdmissionCompletion.Succeeded } as const,
    { outcome: EAdmissionCompletion.Cancelled } as const,
    {
      outcome: EAdmissionCompletion.Failed,
      failure: failure({
        kind: EProviderFailureKind.Auth,
        scope: EProviderFailureScope.Credential,
      }),
    } as const,
  ])('is a no-op for a %o completion', (completion) => {
    expect(completeState({ state, permit: stale, completion, nowIso: iso(T0) })).toBe(state)
  })

  it('is a no-op for a permit on another key', () => {
    const other: AdmissionPermit = {
      ...permitOf({ probe: false }),
      key: { ...key, modelId: 'claude-haiku' },
    }

    expect(
      completeState({
        state,
        permit: other,
        completion: { outcome: EAdmissionCompletion.Succeeded },
        nowIso: iso(T0),
      }),
    ).toBe(state)
  })
})

describe('operator pause', () => {
  it('pauses without an until and blocks admission with no probe', () => {
    const paused = controlState({
      state: undefined,
      key,
      revision,
      action: EAvailabilityControl.Pause,
      nowIso: iso(T0),
    })

    expect(paused.snapshot.availability).toBe(ECredentialAvailability.Paused)
    expect(paused.snapshot.until).toBeUndefined()
    const admitted = admitAt({ state: paused, nowMs: T0 + 10 * PROBE_LEASE_MS })
    expect(admitted.decision.admitted).toBe(false)
  })

  it('persists through failure and success evidence', () => {
    const paused = controlState({
      state: undefined,
      key,
      revision,
      action: EAvailabilityControl.Pause,
      nowIso: iso(T0),
    })

    expect(failedWith({ state: paused, failure: QUOTA })).toEqual(paused)
    expect(
      completeState({
        state: paused,
        permit: permitOf({ probe: false }),
        completion: { outcome: EAdmissionCompletion.Succeeded },
        nowIso: iso(T0),
      }),
    ).toEqual(paused)
  })

  it('ends on resume', () => {
    const paused = controlState({
      state: undefined,
      key,
      revision,
      action: EAvailabilityControl.Pause,
      nowIso: iso(T0),
    })

    const resumed = controlState({
      state: paused,
      key,
      revision,
      action: EAvailabilityControl.Resume,
      nowIso: iso(T0 + 1_000),
    })

    expect(resumed.snapshot.availability).toBe(ECredentialAvailability.Available)
    expect(resumed.snapshot.since).toBe(iso(T0 + 1_000))
  })

  it('ends on credential replacement', () => {
    const paused = controlState({
      state: undefined,
      key,
      revision,
      action: EAvailabilityControl.Pause,
      nowIso: iso(T0),
    })

    expect(
      inspectAt({ state: paused, rev: { fence: ECredentialFence.Replaced, value: 2 } })
        .availability,
    ).toBe(ECredentialAvailability.Available)
  })

  it('leaves a non-paused barrier alone on resume', () => {
    const state = closedState(ECredentialAvailability.AuthRejected)

    expect(
      controlState({
        state,
        key,
        revision,
        action: EAvailabilityControl.Resume,
        nowIso: iso(T0 + 1_000),
      }),
    ).toBe(state)
  })
})
