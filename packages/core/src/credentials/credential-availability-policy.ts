import { EProviderFailureKind, type NormalizedProviderFailure } from '../models/provider-failure'
import {
  EAdmissionCompletion,
  ECredentialAvailability,
  EAvailabilityControl,
  type AdmissionCompletion,
  type AdmissionDecision,
  type AdmissionPermit,
  type AvailabilityKey,
  type AvailabilitySnapshot,
  type CredentialRevision,
} from './credential-availability'

export type ProbeLease = { permit: AdmissionPermit; leasedUntilMs: number }

export type AvailabilityState = {
  snapshot: AvailabilitySnapshot
  probe?: ProbeLease | undefined
}

export const PROBE_LEASE_MS = 120_000

type Identity = { key: AvailabilityKey; revision: CredentialRevision }

const sameIdentity = (args: { a: Identity; b: Identity }): boolean =>
  args.a.key.accountId === args.b.key.accountId &&
  args.a.key.providerId === args.b.key.providerId &&
  args.a.key.modelId === args.b.key.modelId &&
  args.a.revision.fence === args.b.revision.fence &&
  args.a.revision.value === args.b.revision.value

const availableSnapshot = (args: Identity & { nowIso: string }): AvailabilitySnapshot => ({
  key: args.key,
  availability: ECredentialAvailability.Available,
  revision: args.revision,
  since: args.nowIso,
})

const withProbe = (args: {
  snapshot: AvailabilitySnapshot
  probe: ProbeLease | undefined
}): AvailabilityState =>
  args.probe === undefined
    ? { snapshot: args.snapshot }
    : { snapshot: args.snapshot, probe: args.probe }

const isClosed = (snapshot: AvailabilitySnapshot): boolean =>
  snapshot.availability !== ECredentialAvailability.Available

const cooldownLapsed = (args: { snapshot: AvailabilitySnapshot; nowMs: number }): boolean =>
  args.snapshot.availability === ECredentialAvailability.Cooldown &&
  args.snapshot.until !== undefined &&
  Date.parse(args.snapshot.until) <= args.nowMs

const effectiveState = (
  args: Identity & { state: AvailabilityState | undefined; nowMs: number },
): AvailabilityState | undefined => {
  const { state } = args
  if (state === undefined) return undefined
  if (!sameIdentity({ a: state.snapshot, b: args })) return undefined
  if (cooldownLapsed({ snapshot: state.snapshot, nowMs: args.nowMs })) return undefined
  if (state.probe === undefined || state.probe.leasedUntilMs > args.nowMs) return state
  return { snapshot: state.snapshot }
}

export function inspectState(
  args: Identity & { state: AvailabilityState | undefined; nowMs: number; nowIso: string },
): AvailabilitySnapshot {
  return effectiveState(args)?.snapshot ?? availableSnapshot(args)
}

export function admitState(
  args: Identity & { state: AvailabilityState | undefined; nowMs: number; nowIso: string },
): { decision: AdmissionDecision; next: AvailabilityState | undefined } {
  const effective = effectiveState(args)
  const permit = (probe: boolean): AdmissionPermit => ({
    key: args.key,
    revision: args.revision,
    probe,
    admittedAt: args.nowIso,
  })

  if (effective === undefined || !isClosed(effective.snapshot)) {
    return { decision: { admitted: true, permit: permit(false) }, next: effective }
  }

  const blocked = {
    decision: { admitted: false as const, block: { key: args.key, snapshot: effective.snapshot } },
    next: effective,
  }
  if (effective.snapshot.availability === ECredentialAvailability.Paused) return blocked
  if (effective.probe !== undefined) return blocked

  const probePermit = permit(true)
  return {
    decision: { admitted: true, permit: probePermit },
    next: {
      snapshot: effective.snapshot,
      probe: { permit: probePermit, leasedUntilMs: args.nowMs + PROBE_LEASE_MS },
    },
  }
}

type Barrier = { availability: ECredentialAvailability; until?: string | undefined }

const validInstantOf = (value: string | undefined): string | undefined =>
  value !== undefined && Number.isFinite(Date.parse(value)) ? value : undefined

const quotaBarrierOf = (failure: NormalizedProviderFailure): Barrier => {
  const until = validInstantOf(failure.resetAt) ?? validInstantOf(failure.retryAt)
  return until === undefined
    ? { availability: ECredentialAvailability.QuotaExhausted }
    : { availability: ECredentialAvailability.Cooldown, until }
}

const barrierOf = (failure: NormalizedProviderFailure): Barrier | undefined => {
  switch (failure.kind) {
    case EProviderFailureKind.Quota:
      return quotaBarrierOf(failure)
    case EProviderFailureKind.Auth:
      return { availability: ECredentialAvailability.AuthRejected }
    case EProviderFailureKind.Delivery:
      return { availability: ECredentialAvailability.DeliveryFault }
    case EProviderFailureKind.ModelDenied:
      return { availability: ECredentialAvailability.ModelDenied }
    default:
      return undefined
  }
}

const ownsProbe = (args: {
  state: AvailabilityState | undefined
  permit: AdmissionPermit
}): boolean => args.permit.probe && args.state?.probe?.permit.admittedAt === args.permit.admittedAt

const failedState = (args: {
  state: AvailabilityState | undefined
  permit: AdmissionPermit
  failure: NormalizedProviderFailure
  nowIso: string
}): AvailabilityState | undefined => {
  const { state, permit, failure } = args
  const probe = ownsProbe({ state, permit }) ? undefined : state?.probe
  const base = state?.snapshot ?? availableSnapshot({ ...permit, nowIso: args.nowIso })
  const barrier = barrierOf(failure)

  if (barrier === undefined || base.availability === ECredentialAvailability.Paused) {
    return state === undefined ? undefined : withProbe({ snapshot: state.snapshot, probe })
  }

  const snapshot: AvailabilitySnapshot = {
    key: permit.key,
    availability: barrier.availability,
    revision: permit.revision,
    since: base.availability === barrier.availability ? base.since : args.nowIso,
    reason: failure.message,
    ...(barrier.until === undefined ? {} : { until: barrier.until }),
  }
  return withProbe({ snapshot, probe })
}

export function completeState(args: {
  state: AvailabilityState | undefined
  permit: AdmissionPermit
  completion: AdmissionCompletion
  nowIso: string
}): AvailabilityState | undefined {
  const { state, permit, completion } = args
  if (state !== undefined && !sameIdentity({ a: state.snapshot, b: permit })) return state

  switch (completion.outcome) {
    case EAdmissionCompletion.Succeeded:
      return state?.snapshot.availability === ECredentialAvailability.Paused
        ? { snapshot: state.snapshot }
        : undefined
    case EAdmissionCompletion.Cancelled:
      return state === undefined
        ? undefined
        : withProbe({
            snapshot: state.snapshot,
            probe: ownsProbe({ state, permit }) ? undefined : state.probe,
          })
    case EAdmissionCompletion.Failed:
      return failedState({ state, permit, failure: completion.failure, nowIso: args.nowIso })
  }
}

export function promoteProbeState(args: {
  state: AvailabilityState | undefined
  permit: AdmissionPermit
  failure: NormalizedProviderFailure
  nowIso: string
}): AvailabilityState | undefined {
  return completeState({
    state: args.state,
    permit: args.permit,
    completion: { outcome: EAdmissionCompletion.Failed, failure: args.failure },
    nowIso: args.nowIso,
  })
}

export function controlState(
  args: Identity & {
    state: AvailabilityState | undefined
    action: EAvailabilityControl
    nowIso: string
  },
): AvailabilityState {
  const current =
    args.state !== undefined && sameIdentity({ a: args.state.snapshot, b: args })
      ? args.state
      : undefined

  if (args.action === EAvailabilityControl.Pause) {
    return {
      snapshot: {
        key: args.key,
        availability: ECredentialAvailability.Paused,
        revision: args.revision,
        since: args.nowIso,
      },
    }
  }
  if (current?.snapshot.availability === ECredentialAvailability.Paused || current === undefined) {
    return { snapshot: availableSnapshot(args) }
  }
  return current
}
