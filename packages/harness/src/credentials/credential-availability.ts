import {
  admitState,
  completeState,
  controlState,
  CredentialAvailabilityPort,
  ECredentialAvailability,
  inspectState,
  promoteProbeState,
  type AdmissionCompletion,
  type AdmissionDecision,
  type AdmissionPermit,
  type AccountId,
  type AvailabilityKey,
  type AvailabilitySnapshot,
  type AvailabilityState,
  type ClockPort,
  type CredentialRevision,
  type EAvailabilityControl,
  type NormalizedProviderFailure,
} from '@dltech/atlas-core'

const stateKeyOf = (key: AvailabilityKey): string =>
  `${key.accountId}:${key.providerId}:${key.modelId}`

export class InMemoryCredentialAvailability extends CredentialAvailabilityPort {
  private readonly clock: ClockPort
  private readonly states = new Map<string, AvailabilityState>()
  private readonly manualPausedAt: (accountId: AccountId) => Promise<string | null>

  constructor(args: {
    clock: ClockPort
    manualPausedAt?: ((accountId: AccountId) => Promise<string | null>) | undefined
  }) {
    super()
    this.clock = args.clock
    this.manualPausedAt = args.manualPausedAt ?? (async () => null)
  }

  private async manualPause(args: {
    key: AvailabilityKey
    revision: CredentialRevision
  }): Promise<AvailabilitySnapshot | undefined> {
    const since = await this.manualPausedAt(args.key.accountId)
    if (since === null) return undefined
    return {
      key: args.key,
      availability: ECredentialAvailability.Paused,
      revision: args.revision,
      since,
    }
  }

  private instant(): { nowIso: string; nowMs: number } {
    const nowIso = this.clock.now()
    return { nowIso, nowMs: Date.parse(nowIso) }
  }

  private keep(args: { key: AvailabilityKey; state: AvailabilityState | undefined }): void {
    const stateKey = stateKeyOf(args.key)
    if (args.state === undefined) this.states.delete(stateKey)
    else this.states.set(stateKey, args.state)
  }

  async inspect(args: {
    key: AvailabilityKey
    revision: CredentialRevision
  }): Promise<AvailabilitySnapshot> {
    const paused = await this.manualPause(args)
    if (paused !== undefined) return paused
    return inspectState({
      key: args.key,
      revision: args.revision,
      state: this.states.get(stateKeyOf(args.key)),
      ...this.instant(),
    })
  }

  async admit(args: {
    key: AvailabilityKey
    revision: CredentialRevision
  }): Promise<AdmissionDecision> {
    const paused = await this.manualPause(args)
    if (paused !== undefined) {
      return { admitted: false, block: { key: args.key, snapshot: paused } }
    }
    const { decision, next } = admitState({
      key: args.key,
      revision: args.revision,
      state: this.states.get(stateKeyOf(args.key)),
      ...this.instant(),
    })
    this.keep({ key: args.key, state: next })
    return decision
  }

  async promoteProbe(args: {
    permit: AdmissionPermit
    failure: NormalizedProviderFailure
  }): Promise<void> {
    this.keep({
      key: args.permit.key,
      state: promoteProbeState({
        state: this.states.get(stateKeyOf(args.permit.key)),
        permit: args.permit,
        failure: args.failure,
        nowIso: this.instant().nowIso,
      }),
    })
  }

  async complete(args: {
    permit: AdmissionPermit
    completion: AdmissionCompletion
  }): Promise<void> {
    this.keep({
      key: args.permit.key,
      state: completeState({
        state: this.states.get(stateKeyOf(args.permit.key)),
        permit: args.permit,
        completion: args.completion,
        nowIso: this.instant().nowIso,
      }),
    })
  }

  async control(args: {
    key: AvailabilityKey
    revision: CredentialRevision
    action: EAvailabilityControl
  }): Promise<AvailabilitySnapshot> {
    const state = controlState({
      key: args.key,
      revision: args.revision,
      state: this.states.get(stateKeyOf(args.key)),
      action: args.action,
      nowIso: this.instant().nowIso,
    })
    this.keep({ key: args.key, state })
    return state.snapshot
  }
}
