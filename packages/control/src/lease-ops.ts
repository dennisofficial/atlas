import {
  claim,
  grant,
  isLive,
  renew,
  revoke,
  revokeIfEpoch,
  type ClaimResult,
  type Lease,
  type LeaseResult,
  type RevokeResult,
} from '@dltech/atlas-core'

import { LeaseConflictError } from './errors'
import type { ControlStorePort, ControlTx } from './port'

export const initialLease = (params: { sessionId: string; now: string }): Lease => ({
  sessionId: params.sessionId,
  epoch: 0,
  holderId: null,
  renewedAt: params.now,
  ttlMs: 0,
  wantsHolder: false,
})

export class LeaseOps {
  private readonly store: ControlStorePort
  private readonly nowIn: (tx: ControlTx) => Promise<string>

  constructor(params: {
    store: ControlStorePort
    nowIn: (tx: ControlTx) => Promise<string>
  }) {
    this.store = params.store
    this.nowIn = params.nowIn
  }

  async leaseOf(params: { tx: ControlTx; sessionId: string; now: string }): Promise<Lease> {
    return (await params.tx.readLease(params.sessionId)) ?? initialLease(params)
  }

  async grant(params: { sessionId: string; holderId: string; ttlMs: number }): Promise<Lease> {
    const result = await this.mutateLease({
      sessionId: params.sessionId,
      decide: (lease, now) => ({
        ok: true,
        lease: grant({ lease, holderId: params.holderId, ttlMs: params.ttlMs, now }),
      }),
    })
    if (!result.ok) throw new LeaseConflictError(params.sessionId)
    return result.lease
  }

  async claimLease(params: {
    sessionId: string
    holderId: string
    ttlMs: number
  }): Promise<ClaimResult> {
    return this.store.transact(async (tx) => {
      const current = await tx.lockLease(params.sessionId)
      const now = await this.nowIn(tx)
      const lease = current ?? initialLease({ sessionId: params.sessionId, now })
      const result = claim({ lease, holderId: params.holderId, ttlMs: params.ttlMs, now })
      if (!result.ok) return result
      const written = await tx.writeLease({ lease: result.lease, expectedEpoch: lease.epoch })
      if (!written) throw new LeaseConflictError(params.sessionId)
      return result
    })
  }

  async renew(params: {
    sessionId: string
    holderId: string
    epoch: number
  }): Promise<LeaseResult> {
    return this.mutateLease({
      sessionId: params.sessionId,
      decide: (lease, now) => renew({ lease, holderId: params.holderId, epoch: params.epoch, now }),
    })
  }

  async revokeIfEpoch(params: {
    sessionId: string
    wantsHolder: boolean
    epoch: number
  }): Promise<RevokeResult> {
    return this.mutateLease({
      sessionId: params.sessionId,
      wakeOnWrite: params.wantsHolder,
      decide: (lease, now) =>
        revokeIfEpoch({ lease, wantsHolder: params.wantsHolder, epoch: params.epoch, now }),
    }) as Promise<RevokeResult>
  }

  async revoke(params: { sessionId: string; wantsHolder: boolean }): Promise<Lease> {
    const result = await this.mutateLease({
      sessionId: params.sessionId,
      wakeOnWrite: params.wantsHolder,
      decide: (lease, now) => ({
        ok: true,
        lease: revoke({ lease, wantsHolder: params.wantsHolder, now }),
      }),
    })
    if (!result.ok) throw new LeaseConflictError(params.sessionId)
    return result.lease
  }

  async currentLease(params: { sessionId: string }): Promise<{ lease: Lease; live: boolean }> {
    return this.store.transact(async (tx) => {
      const now = await this.nowIn(tx)
      const lease = await this.leaseOf({ tx, ...params, now })
      return { lease, live: isLive({ lease, now }) }
    })
  }

  private async mutateLease(params: {
    sessionId: string
    wakeOnWrite?: boolean | undefined
    decide: (lease: Lease, now: string) => LeaseResult
  }): Promise<LeaseResult> {
    return this.store.transact(async (tx) => {
      const current = await tx.lockLease(params.sessionId)
      const now = await this.nowIn(tx)
      const lease = current ?? initialLease({ sessionId: params.sessionId, now })
      const result = params.decide(lease, now)
      if (!result.ok) return result
      const written = await tx.writeLease({ lease: result.lease, expectedEpoch: lease.epoch })
      if (!written) throw new LeaseConflictError(params.sessionId)
      if (params.wakeOnWrite === true) await tx.notifyWake(params.sessionId)
      return result
    })
  }
}
