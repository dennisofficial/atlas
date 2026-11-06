export type Lease = {
  sessionId: string
  epoch: number
  holderHostId: number | null
  wantsHolder: boolean
  attempts: number
  retryAfter: string | null
}

export type LeaseRefusal = { kind: 'stale-epoch'; current: number }

export type RevokeResult = { ok: true; lease: Lease } | { ok: false; refusal: LeaseRefusal }

export type ClaimRefusal = { kind: 'held'; epoch: number } | { kind: 'not-present' }

export type ClaimResult = { ok: true; lease: Lease } | { ok: false; refusal: ClaimRefusal }

export function claim(params: {
  lease: Lease
  hostId: number
  holderPresent: boolean
  selfPresent: boolean
}): ClaimResult {
  if (params.lease.holderHostId !== null && params.holderPresent) {
    return { ok: false, refusal: { kind: 'held', epoch: params.lease.epoch } }
  }
  if (!params.selfPresent) return { ok: false, refusal: { kind: 'not-present' } }
  return { ok: true, lease: grant({ lease: params.lease, hostId: params.hostId }) }
}

export const grant = (params: { lease: Lease; hostId: number }): Lease => ({
  ...params.lease,
  epoch: params.lease.epoch + 1,
  holderHostId: params.hostId,
  wantsHolder: false,
})

export const retryDelayMs = (attempts: number): number =>
  Math.min(1000 * 2 ** (attempts - 1), 30000)

export const claimGrant = (params: { lease: Lease; hostId: number; now: string }): Lease => {
  const attempts = params.lease.attempts + 1
  return {
    ...grant({ lease: params.lease, hostId: params.hostId }),
    attempts,
    retryAfter: new Date(Date.parse(params.now) + retryDelayMs(attempts)).toISOString(),
  }
}

export const revoke = (params: { lease: Lease; wantsHolder: boolean }): Lease => ({
  ...params.lease,
  epoch: params.lease.epoch + 1,
  holderHostId: null,
  wantsHolder: params.wantsHolder,
})

export const revokeIfEpoch = (params: {
  lease: Lease
  wantsHolder: boolean
  epoch: number
}): RevokeResult => {
  if (params.epoch !== params.lease.epoch) {
    return { ok: false, refusal: { kind: 'stale-epoch', current: params.lease.epoch } }
  }
  return {
    ok: true,
    lease: revoke({ lease: params.lease, wantsHolder: params.wantsHolder }),
  }
}
