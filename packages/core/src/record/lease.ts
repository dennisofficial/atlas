export type Lease = {
  sessionId: string
  epoch: number
  holderId: string | null
  renewedAt: string
  ttlMs: number
  wantsHolder: boolean
}

export type LeaseRefusal = { kind: 'stale-epoch'; current: number } | { kind: 'lease-expired' }

export type LeaseResult = { ok: true; lease: Lease } | { ok: false; refusal: LeaseRefusal }

export const isLive = (params: { lease: Lease; now: string }): boolean =>
  params.lease.holderId !== null &&
  Date.parse(params.now) < Date.parse(params.lease.renewedAt) + params.lease.ttlMs

export const grant = (params: {
  lease: Lease
  holderId: string
  ttlMs: number
  now: string
}): Lease => ({
  ...params.lease,
  epoch: params.lease.epoch + 1,
  holderId: params.holderId,
  renewedAt: params.now,
  ttlMs: params.ttlMs,
  wantsHolder: false,
})

export const revoke = (params: { lease: Lease; wantsHolder: boolean; now: string }): Lease => ({
  ...params.lease,
  epoch: params.lease.epoch + 1,
  holderId: null,
  renewedAt: params.now,
  wantsHolder: params.wantsHolder,
})

export function renew(params: {
  lease: Lease
  holderId: string
  epoch: number
  now: string
}): LeaseResult {
  const { lease } = params
  if (params.epoch !== lease.epoch || lease.holderId !== params.holderId) {
    return { ok: false, refusal: { kind: 'stale-epoch', current: lease.epoch } }
  }
  if (!isLive({ lease, now: params.now })) return { ok: false, refusal: { kind: 'lease-expired' } }
  return { ok: true, lease: { ...lease, renewedAt: params.now } }
}
