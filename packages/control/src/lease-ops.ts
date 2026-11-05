import {
  claim,
  grant,
  revoke,
  revokeIfEpoch,
  type ClaimResult,
  type Lease,
  type RevokeResult,
} from '@dltech/atlas-core'

import { LeaseConflictError } from './errors'
import type { ControlStorePort, ControlTx } from './port'

export const initialLease = (params: { sessionId: string }): Lease => ({
  sessionId: params.sessionId,
  epoch: 0,
  holderHostId: null,
  wantsHolder: false,
})

export class LeaseOps {
  private readonly store: ControlStorePort

  constructor(params: { store: ControlStorePort }) {
    this.store = params.store
  }

  async sharedLeaseOf(params: { tx: ControlTx; sessionId: string }): Promise<Lease> {
    return (await params.tx.shareLease(params.sessionId)) ?? initialLease(params)
  }

  async grant(params: { sessionId: string; hostId: number }): Promise<Lease> {
    const result = await this.mutateLease({
      sessionId: params.sessionId,
      decide: (lease) => ({
        ok: true,
        lease: grant({ lease, hostId: params.hostId }),
      }),
    })
    if (!result.ok) throw new LeaseConflictError(params.sessionId)
    return result.lease
  }

  async claimLease(params: { sessionId: string; hostId: number }): Promise<ClaimResult> {
    return this.store.transact(async (tx) => {
      const lease =
        (await tx.lockLease(params.sessionId)) ?? initialLease({ sessionId: params.sessionId })
      const holderPresent =
        lease.holderHostId !== null && (await tx.hostPresent(lease.holderHostId))
      const selfPresent = await tx.hostPresent(params.hostId)
      const result = claim({
        lease,
        hostId: params.hostId,
        holderPresent,
        selfPresent,
      })
      if (!result.ok) return result
      const written = await tx.writeLease({
        lease: result.lease,
        expectedEpoch: lease.epoch,
      })
      if (!written) throw new LeaseConflictError(params.sessionId)
      await tx.announce({ sessionId: params.sessionId })
      return result
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
      decide: (lease) =>
        revokeIfEpoch({
          lease,
          wantsHolder: params.wantsHolder,
          epoch: params.epoch,
        }),
    })
  }

  async revoke(params: { sessionId: string; wantsHolder: boolean }): Promise<Lease> {
    const result = await this.mutateLease({
      sessionId: params.sessionId,
      wakeOnWrite: params.wantsHolder,
      decide: (lease) => ({
        ok: true,
        lease: revoke({ lease, wantsHolder: params.wantsHolder }),
      }),
    })
    if (!result.ok) throw new LeaseConflictError(params.sessionId)
    return result.lease
  }

  async currentLease(params: { sessionId: string }): Promise<{ lease: Lease; live: boolean }> {
    return this.store.transact(async (tx) => {
      const lease = (await tx.readLease(params.sessionId)) ?? initialLease(params)
      const live = lease.holderHostId !== null && (await tx.hostPresent(lease.holderHostId))
      return { lease, live }
    })
  }

  private async mutateLease(params: {
    sessionId: string
    wakeOnWrite?: boolean | undefined
    decide: (lease: Lease) => RevokeResult
  }): Promise<RevokeResult> {
    return this.store.transact(async (tx) => {
      const lease =
        (await tx.lockLease(params.sessionId)) ?? initialLease({ sessionId: params.sessionId })
      const result = params.decide(lease)
      if (!result.ok) return result
      const written = await tx.writeLease({
        lease: result.lease,
        expectedEpoch: lease.epoch,
      })
      if (!written) throw new LeaseConflictError(params.sessionId)
      await tx.announce({ sessionId: params.sessionId })
      if (params.wakeOnWrite === true) await tx.notifyWake(params.sessionId)
      return result
    })
  }
}
