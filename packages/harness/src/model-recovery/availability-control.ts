import {
  EAvailabilityControl,
  ECredentialAvailability,
  EAvailabilityControlResult,
  EWaitEpisodeKind,
  revisionOf,
  type AccountId,
  type AccountStorePort,
  type AvailabilityKey,
  type AvailabilitySnapshot,
  type CredentialAvailabilityPort,
  type CredentialRevision,
  type ThreadId,
  type WaitingForModel,
} from '@dltech/atlas-core'
import { EAvailabilityAction } from '@dltech/atlas-wire'

import type { ModelWaitState } from './wait-state'

export { EAvailabilityAction }

export enum EAvailabilityAuthority {
  Local = 'local',
  Cloud = 'cloud',
  Sandbox = 'sandbox',
}

export type AvailabilityControlOutcome = {
  result: EAvailabilityControlResult
  snapshot: AvailabilitySnapshot
}

export type AvailabilityControlRequest = {
  key: AvailabilityKey
  expectedGeneration: number
  requestId: string
  action: EAvailabilityAction
}

export type AvailabilityControlDeps = {
  availability: Pick<CredentialAvailabilityPort, 'inspect' | 'control'>
  accounts: Pick<AccountStorePort, 'read'>
  localVault: Pick<AccountStorePort, 'setManualPause'>
  waitState: Pick<ModelWaitState, 'waiting' | 'reconcile'>
  wakeChild: (args: { threadId: ThreadId }) => Promise<unknown> | undefined
  authorityOf: (accountId: AccountId) => Promise<EAvailabilityAuthority>
  probeOutstanding?: ((args: Target) => boolean) | undefined
}

export class AvailabilityControlRefusedError extends Error {
  constructor() {
    super('a Cloud account is paused from Atlas Cloud, not from this session')
    this.name = 'AvailabilityControlRefusedError'
  }
}

export class AvailabilityControlAccountMissingError extends Error {
  constructor(accountId: string) {
    super(`account ${accountId} is not available to control`)
    this.name = 'AvailabilityControlAccountMissingError'
  }
}

enum EReleaseScope {
  Model = 'model',
  Account = 'account',
}

type Target = { key: AvailabilityKey; revision: CredentialRevision }

const MAX_REMEMBERED_REQUESTS = 128

const stateKeyOf = (key: AvailabilityKey): string =>
  `${key.accountId}:${key.providerId}:${key.modelId}`

const isPaused = (snapshot: AvailabilitySnapshot): boolean =>
  snapshot.availability === ECredentialAvailability.Paused

const isAvailable = (snapshot: AvailabilitySnapshot): boolean =>
  snapshot.availability === ECredentialAvailability.Available

export class AvailabilityControl {
  private readonly remembered = new Map<string, Promise<AvailabilityControlOutcome>>()
  private readonly lastSnapshots = new Map<string, AvailabilitySnapshot>()
  private rootWake: ((args: { threadId: ThreadId }) => void) | undefined

  constructor(private readonly deps: AvailabilityControlDeps) {}

  bindRootWake(wake: (args: { threadId: ThreadId }) => void): () => void {
    this.rootWake = wake
    return () => {
      if (this.rootWake === wake) this.rootWake = undefined
    }
  }

  authorityOf(accountId: AccountId): Promise<EAvailabilityAuthority> {
    return this.deps.authorityOf(accountId)
  }

  waiting(): readonly WaitingForModel[] {
    return this.deps.waitState.waiting()
  }

  control(request: AvailabilityControlRequest): Promise<AvailabilityControlOutcome> {
    const prior = this.remembered.get(request.requestId)
    if (prior !== undefined) return prior
    const running = this.apply(request)
    this.remembered.set(request.requestId, running)
    running.catch(() => this.remembered.delete(request.requestId))
    const oldest = this.remembered.keys().next()
    if (this.remembered.size > MAX_REMEMBERED_REQUESTS && !oldest.done) {
      this.remembered.delete(oldest.value)
    }
    return running
  }

  private async apply(request: AvailabilityControlRequest): Promise<AvailabilityControlOutcome> {
    const { key, action } = request
    const authority = await this.deps.authorityOf(key.accountId)
    if (action !== EAvailabilityAction.Recheck && authority === EAvailabilityAuthority.Sandbox) {
      throw new AvailabilityControlRefusedError()
    }
    const stored = await this.deps.accounts.read(key.accountId)
    if (stored === undefined) throw new AvailabilityControlAccountMissingError(key.accountId)
    const target: Target = { key, revision: revisionOf(stored) }
    try {
      if (target.revision.value !== request.expectedGeneration) {
        return { result: EAvailabilityControlResult.Stale, snapshot: await this.inspect(target) }
      }
      return await this.run({ target, action, authority })
    } catch (error) {
      const last = this.lastSnapshots.get(stateKeyOf(key))
      if (last === undefined) throw error
      return { result: EAvailabilityControlResult.Unreachable, snapshot: last }
    }
  }

  private run(args: {
    target: Target
    action: EAvailabilityAction
    authority: EAvailabilityAuthority
  }): Promise<AvailabilityControlOutcome> {
    switch (args.action) {
      case EAvailabilityAction.Pause:
        return this.pause(args)
      case EAvailabilityAction.RemoveManualPause:
        return this.removePause(args)
      case EAvailabilityAction.Recheck:
        return this.recheck(args.target)
    }
  }

  private async inspect(target: Target): Promise<AvailabilitySnapshot> {
    const snapshot = await this.deps.availability.inspect(target)
    this.lastSnapshots.set(stateKeyOf(target.key), snapshot)
    return snapshot
  }

  private async setPause(args: {
    target: Target
    authority: EAvailabilityAuthority
    paused: boolean
  }): Promise<AvailabilitySnapshot> {
    const { target, authority, paused } = args
    if (authority === EAvailabilityAuthority.Cloud) {
      const snapshot = await this.deps.availability.control({
        ...target,
        action: paused ? EAvailabilityControl.Pause : EAvailabilityControl.Resume,
      })
      this.lastSnapshots.set(stateKeyOf(target.key), snapshot)
      return snapshot
    }
    await this.deps.localVault.setManualPause({ accountId: target.key.accountId, paused })
    return this.inspect(target)
  }

  private async pause(args: {
    target: Target
    authority: EAvailabilityAuthority
  }): Promise<AvailabilityControlOutcome> {
    const snapshot = await this.setPause({ ...args, paused: true })
    return { result: EAvailabilityControlResult.Applied, snapshot }
  }

  private async removePause(args: {
    target: Target
    authority: EAvailabilityAuthority
  }): Promise<AvailabilityControlOutcome> {
    const { target } = args
    const snapshot = await this.setPause({ ...args, paused: false })
    if (!isAvailable(snapshot)) {
      return { result: EAvailabilityControlResult.Unavailable, snapshot }
    }
    await this.release({ target, scope: EReleaseScope.Account })
    return { result: EAvailabilityControlResult.Available, snapshot }
  }

  private async recheck(target: Target): Promise<AvailabilityControlOutcome> {
    const snapshot = await this.inspect(target)
    if (isPaused(snapshot)) return { result: EAvailabilityControlResult.Unavailable, snapshot }
    if (this.deps.probeOutstanding?.(target) === true) {
      return { result: EAvailabilityControlResult.ProbeInProgress, snapshot }
    }
    await this.release({ target, scope: EReleaseScope.Model })
    return {
      result: isAvailable(snapshot)
        ? EAvailabilityControlResult.Available
        : EAvailabilityControlResult.Applied,
      snapshot,
    }
  }

  private async release(args: { target: Target; scope: EReleaseScope }): Promise<void> {
    const { target, scope } = args
    const inScope = (episode: AvailabilityKey): boolean =>
      episode.accountId === target.key.accountId &&
      (scope === EReleaseScope.Account ||
        (episode.providerId === target.key.providerId && episode.modelId === target.key.modelId))

    const woken = new Set<ThreadId>()
    for (const waiting of this.deps.waitState.waiting()) {
      if (waiting.episode.kind !== EWaitEpisodeKind.Credential) continue
      if (!inScope(waiting.episode.key)) continue
      for (const threadId of waiting.affectedThreadIds) woken.add(threadId)
    }

    await this.deps.waitState.reconcile({
      eligible: async (waiting) => {
        if (waiting.episode.kind !== EWaitEpisodeKind.Credential) return false
        const { key } = waiting.episode
        if (!inScope(key)) return false
        return isAvailable(await this.deps.availability.inspect({ key, revision: target.revision }))
      },
    })
    for (const threadId of woken) {
      this.wake({ threadId })
    }
  }

  private wake(args: { threadId: ThreadId }): void {
    const child = this.deps.wakeChild(args)
    if (child !== undefined) {
      child.catch(() => undefined)
      return
    }
    try {
      this.rootWake?.(args)
    } catch {
      return
    }
  }
}
