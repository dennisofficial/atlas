import { randomUUID } from 'node:crypto'
import {
  admitState,
  completeState,
  controlState,
  inspectState,
  promoteProbeState,
  PROBE_LEASE_MS,
  type AdmissionCompletion,
  type AdmissionPermit,
  type AvailabilityState,
  type EAvailabilityControl,
  type NormalizedProviderFailure,
} from '@dltech/atlas-core'
import { db, type Row, type Tx } from '@dltech/atlas-db'
import type {
  AdmissionDecision,
  AdmissionPermit as WirePermit,
  AvailabilitySnapshot,
  ControlAvailabilityInput,
  InspectAvailabilityInput,
} from '@dltech/atlas-wire'
import { Injectable } from '@nestjs/common'
import {
  completionOf,
  failureOf,
  permitOf,
  refOf,
  stateOfRow,
  wireAdmittedOf,
  wireBlockedOf,
  wireSnapshotOf,
} from './credential-availability-mapping'
import {
  claimProbe,
  dropLapsedRow,
  EBarrierLock,
  lockBarrier,
  persistState,
  readInstant,
  readRow,
  type DbInstant,
  type BarrierScope,
} from './credential-availability.repository'

type Settlement = (args: {
  state: AvailabilityState | undefined
  permit: AdmissionPermit
  instant: DbInstant
}) => AvailabilityState | undefined

const holdsLiveProbe = (args: {
  row: Row<'CredentialAvailability'> | null
  permit: WirePermit
  instant: DbInstant
}): boolean =>
  args.row !== null &&
  args.row.probeId === args.permit.permitId &&
  args.row.probeExpiresAt !== null &&
  args.row.probeExpiresAt.getTime() > args.instant.nowMs

@Injectable()
export class CredentialAvailabilityService {
  inspect(args: {
    userId: string
    input: InspectAvailabilityInput
  }): Promise<AvailabilitySnapshot> {
    const ref = refOf(args.input)
    const scope: BarrierScope = { userId: args.userId, key: ref.key }
    return db.transaction(async (tx) => {
      const instant = await readInstant(tx)
      const row = await readRow({ tx, scope })
      return wireSnapshotOf(inspectState({ ...ref, state: stateOfRow(row), ...instant }))
    })
  }

  admit(args: { userId: string; input: InspectAvailabilityInput }): Promise<AdmissionDecision> {
    const ref = refOf(args.input)
    const scope: BarrierScope = { userId: args.userId, key: ref.key }
    return db.transaction(async (tx) => {
      await lockBarrier({ tx, scope, mode: EBarrierLock.Shared })
      const instant = await readInstant(tx)
      const row = await readRow({ tx, scope })
      const { decision, next } = admitState({
        ...ref,
        state: stateOfRow(row),
        ...instant,
      })
      if (!decision.admitted) return wireBlockedOf(decision.block.snapshot)

      const { permit } = decision
      if (!permit.probe) {
        if (row !== null && next === undefined) await dropLapsedRow({ tx, row })
        return wireAdmittedOf({ permit, permitId: randomUUID() })
      }
      if (row === null || next === undefined) throw new Error('probe admitted without a barrier')

      const probeId = randomUUID()
      const claimed = await claimProbe({
        tx,
        userId: args.userId,
        rowId: row.id,
        probeId,
        instant,
        leaseMs: PROBE_LEASE_MS,
      })
      if (!claimed) return wireBlockedOf(next.snapshot)
      return wireAdmittedOf({ permit, permitId: probeId })
    })
  }

  async complete(args: {
    userId: string
    permit: WirePermit
    completion: Parameters<typeof completionOf>[0]
  }): Promise<void> {
    const completion: AdmissionCompletion = completionOf(args.completion)
    await this.settle({
      userId: args.userId,
      wirePermit: args.permit,
      settlement: ({ state, permit, instant }) =>
        completeState({ state, permit, completion, nowIso: instant.nowIso }),
    })
  }

  async promoteProbe(args: {
    userId: string
    permit: WirePermit
    failure: Parameters<typeof failureOf>[0]
  }): Promise<void> {
    const failure: NormalizedProviderFailure = failureOf(args.failure)
    await this.settle({
      userId: args.userId,
      wirePermit: args.permit,
      settlement: ({ state, permit, instant }) =>
        promoteProbeState({ state, permit, failure, nowIso: instant.nowIso }),
    })
  }

  control(args: {
    userId: string
    input: ControlAvailabilityInput
  }): Promise<AvailabilitySnapshot> {
    const ref = refOf(args.input)
    const scope: BarrierScope = { userId: args.userId, key: ref.key }
    const action: EAvailabilityControl = args.input.action
    return db.transaction(async (tx) => {
      await lockBarrier({ tx, scope, mode: EBarrierLock.Exclusive })
      const instant = await readInstant(tx)
      const row = await readRow({ tx, scope })
      const state = controlState({
        ...ref,
        state: stateOfRow(row),
        action,
        nowIso: instant.nowIso,
      })
      await persistState({ tx, scope, state })
      return wireSnapshotOf(state.snapshot)
    })
  }

  private settle(args: {
    userId: string
    wirePermit: WirePermit
    settlement: Settlement
  }): Promise<void> {
    const permit = permitOf(args.wirePermit)
    const scope: BarrierScope = { userId: args.userId, key: permit.key }
    return db.transaction(async (tx: Tx) => {
      await lockBarrier({ tx, scope, mode: EBarrierLock.Exclusive })
      const instant = await readInstant(tx)
      const row = await readRow({ tx, scope })
      const state = stateOfRow(row)
      if (permit.probe && !holdsLiveProbe({ row, permit: args.wirePermit, instant })) return
      const claimed =
        permit.probe && state?.probe !== undefined
          ? { ...permit, admittedAt: state.probe.permit.admittedAt }
          : permit
      const next = args.settlement({ state, permit: claimed, instant })
      await persistState({ tx, scope, state: next })
    })
  }
}
