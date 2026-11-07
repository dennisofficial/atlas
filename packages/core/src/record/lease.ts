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

export const MAX_START_ATTEMPTS = 5

export const crashLooped = (lease: Lease): boolean => lease.attempts > MAX_START_ATTEMPTS

export const startVerdict = (params: {
  attempts: number
  permanent: boolean
}): { permanent: boolean; giveUp: boolean } => ({
  permanent: params.permanent,
  giveUp: params.permanent || params.attempts >= MAX_START_ATTEMPTS,
})

export const revoke = (params: {
  lease: Lease
  wantsHolder: boolean
  resetRetry?: boolean | undefined
}): Lease => ({
  ...params.lease,
  epoch: params.lease.epoch + 1,
  holderHostId: null,
  wantsHolder: params.wantsHolder,
  ...(params.resetRetry === true ? { attempts: 0, retryAfter: null } : {}),
})

export const revokeIfEpoch = (params: {
  lease: Lease
  wantsHolder: boolean
  epoch: number
  resetRetry?: boolean | undefined
}): RevokeResult => {
  if (params.epoch !== params.lease.epoch) {
    return { ok: false, refusal: { kind: 'stale-epoch', current: params.lease.epoch } }
  }
  return {
    ok: true,
    lease: revoke({
      lease: params.lease,
      wantsHolder: params.wantsHolder,
      resetRetry: params.resetRetry,
    }),
  }
}
