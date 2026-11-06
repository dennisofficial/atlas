import { toThreadId, type IdPort, type Lease } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { HostBus, HostPresence, HostTimers, SessionRuntimeFactory } from './ports'
import { HeldSession, type HeldSessionDeps } from './held-session'
import { HolderPresence } from './holder-presence'
import { HolderSweep } from './holder-sweep'
import { listNeedingHolder } from './needing-holder-list'
import { auditOwnLeases } from './own-lease-audit'
import { DEFAULT_APPEND_RETRY_MS } from './record/retry-deadline'
import { ResyncRetry } from './resync-retry'
import { StartBackoff } from './start-backoff'

export type SessionHolderArgs = {
  presence: HostPresence
  plane: ControlPlane
  bus: HostBus
  timers: HostTimers
  runtimes: SessionRuntimeFactory
  ids: IdPort
  maxSessions: number
  appendRetryMs?: number | undefined
  idleMinutes?: number | undefined
  sweepMs?: number | undefined
  log?: LogPort | undefined
  onHostIdChanged?: (() => void) | undefined
}

const DEFAULTS = {
  appendRetryMs: DEFAULT_APPEND_RETRY_MS,
  idleMinutes: 30,
  sweepMs: 20_000,
} as const

export class SessionHolder {
  private readonly presence: HolderPresence
  private readonly plane: ControlPlane
  private readonly bus: HostBus
  private readonly timers: HostTimers
  private readonly runtimes: SessionRuntimeFactory
  private readonly ids: IdPort
  private readonly maxSessions: number
  private readonly appendRetryMs: number
  private readonly idleMinutes: number
  private readonly log: LogPort | undefined

  private readonly held = new Map<string, HeldSession>()
  private readonly pendingClaims = new Map<string, Promise<void>>()
  private unsubWake: (() => void) | undefined
  private unsubResync: (() => void) | undefined
  private readonly resyncRetry: ResyncRetry
  private readonly sweep: HolderSweep
  private readonly startBackoff: StartBackoff
  private draining = false

  constructor(args: SessionHolderArgs) {
    this.presence = new HolderPresence({
      presence: args.presence,
      timers: args.timers,
      log: args.log,
      onLost: (hostId) => this.handlePresenceLost(hostId),
      onRegistered: () => void this.onResync(),
      onChanged: args.onHostIdChanged,
    })
    this.plane = args.plane
    this.bus = args.bus
    this.timers = args.timers
    this.runtimes = args.runtimes
    this.ids = args.ids
    this.maxSessions = args.maxSessions
    this.appendRetryMs = args.appendRetryMs ?? DEFAULTS.appendRetryMs
    this.idleMinutes = args.idleMinutes ?? DEFAULTS.idleMinutes
    this.log = args.log
    this.resyncRetry = new ResyncRetry({
      timers: args.timers,
      retry: () => void this.onResync(),
      draining: () => this.draining,
    })
    this.sweep = new HolderSweep({
      timers: args.timers,
      intervalMs: args.sweepMs ?? DEFAULTS.sweepMs,
      tick: () => this.sweepOnce(),
    })
    this.startBackoff = new StartBackoff({
      timers: args.timers,
      onDue: (sessionId) => this.onWake(sessionId),
    })
  }

  async start(): Promise<void> {
    await this.presence.start()
    this.unsubWake = this.bus.onWake((sessionId) => {
      this.onWake(sessionId)
    })
    this.unsubResync = this.bus.onResync(() => {
      void this.onResync()
    })
    this.sweep.start()
  }

  async drain(args: { deadline: number }): Promise<void> {
    this.draining = true
    this.stopTriggers()
    const sessions = [...this.held.values()]
    for (const session of sessions) session.beginDrain()
    await Promise.all(
      sessions.map((session) =>
        session.handoff({ deadline: args.deadline }).catch((error) => {
          this.log?.error({
            source: 'holder.drain',
            message: `handing off ${session.sessionId} failed`,
            ...logFieldsOf({ error }),
          })
        }),
      ),
    )
  }

  private stopTriggers(): void {
    this.unsubWake?.()
    this.unsubResync?.()
    this.presence.stop()
    this.sweep.stop()
    this.resyncRetry.cancel()
    this.startBackoff.cancelAll()
  }

  hostId(): number | undefined {
    return this.presence.current()
  }

  heldIds(): readonly string[] {
    return [...this.held.keys()]
  }

  discard(): void {
    this.draining = true
    this.stopTriggers()
    for (const session of this.held.values()) session.discard()
  }

  private handlePresenceLost(hostId: number): void {
    this.log?.error({
      source: 'holder.presence',
      message: `host presence ${hostId} was lost; dropping ${this.held.size} held sessions`,
      data: { hostId, held: this.held.size },
    })
    const sessions = [...this.held.values()]
    this.held.clear()
    for (const session of sessions) session.loseLease()
  }

  private onWake(sessionId: string): void {
    if (this.draining) return
    const held = this.held.get(sessionId)
    if (held !== undefined) {
      held.notifyWake()
      return
    }
    if (this.pendingClaims.has(sessionId) || this.startBackoff.waiting(sessionId)) return
    if (this.held.size + this.pendingClaims.size >= this.maxSessions) return
    const pending: Promise<void> = this.claimAndHold(sessionId).then((claimHostId) => {
      if (this.pendingClaims.get(sessionId) === pending) this.pendingClaims.delete(sessionId)
      if (this.superseded(claimHostId)) this.onWake(sessionId)
    })
    this.pendingClaims.set(sessionId, pending)
  }

  private superseded(hostId: number | undefined): boolean {
    return hostId !== undefined && !this.draining && hostId !== this.presence.current()
  }

  private async onResync(): Promise<void> {
    if (this.draining) return
    for (const session of this.held.values()) session.notifyWake()
    const ids = await listNeedingHolder({
      plane: this.plane,
      limit: this.maxSessions,
      log: this.log,
    })
    if (ids === undefined) return this.resyncRetry.schedule()
    this.resyncRetry.succeeded()
    for (const sessionId of ids) this.onWake(sessionId)
  }

  private async sweepOnce(): Promise<void> {
    const hostId = this.presence.current()
    if (this.draining || hostId === undefined) return
    await auditOwnLeases({
      plane: this.plane,
      hostId,
      isRunning: (sessionId) => this.held.has(sessionId) || this.pendingClaims.has(sessionId),
      log: this.log,
    })
    await this.onResync()
  }

  private async claimAndHold(sessionId: string): Promise<number | undefined> {
    const hostId = this.presence.current()
    if (hostId === undefined) return undefined
    let claimed: Lease | undefined
    try {
      const claimStartedAt = this.timers.now()
      const claim = await this.plane.claim({ sessionId, hostId })
      if (!claim.ok) return hostId
      claimed = claim.lease
      await this.hold({
        sessionId,
        hostId,
        lease: claim.lease,
        claimMs: this.timers.now() - claimStartedAt,
      })
    } catch (error) {
      this.log?.error({
        source: 'holder.claim',
        message: `claiming ${sessionId} failed`,
        ...logFieldsOf({ error }),
      })
      if (claimed !== undefined && !this.held.has(sessionId)) {
        await this.releaseUnstarted({ sessionId, epoch: claimed.epoch })
      }
    }
    return hostId
  }

  private async releaseUnstarted(args: { sessionId: string; epoch: number }): Promise<void> {
    await this.plane
      .revoke({ sessionId: args.sessionId, wantsHolder: true, epoch: args.epoch })
      .catch(() => undefined)
    if (!this.draining) this.startBackoff.failed(args.sessionId)
  }

  private async hold(args: {
    sessionId: string
    hostId: number
    lease: Lease
    claimMs: number
  }): Promise<void> {
    const row =
      this.superseded(args.hostId) || this.draining
        ? undefined
        : await this.plane.readSession({ sessionId: args.sessionId })
    if (row === undefined || this.draining || this.superseded(args.hostId)) {
      await this.plane
        .revoke({ sessionId: args.sessionId, wantsHolder: true, epoch: args.lease.epoch })
        .catch(() => undefined)
      return
    }
    const session = new HeldSession(
      this.deps({
        sessionId: args.sessionId,
        onDrop: () => {
          if (this.held.get(args.sessionId) === session) this.held.delete(args.sessionId)
        },
      }),
    )
    this.held.set(args.sessionId, session)
    const done = session.run({
      lease: args.lease,
      threadId: toThreadId(row.mainThreadId),
      claimMs: args.claimMs,
    })
    done.then(
      () => {
        if (this.held.get(args.sessionId) === session) this.held.delete(args.sessionId)
        if (session.startFailed && !this.draining) this.startBackoff.failed(args.sessionId)
        else this.startBackoff.started(args.sessionId)
      },
      (error) => {
        this.log?.error({
          source: 'holder.session',
          message: `the drive of ${args.sessionId} rejected past its guard`,
          ...logFieldsOf({ error }),
        })
        if (this.held.get(args.sessionId) === session) this.held.delete(args.sessionId)
      },
    )
  }

  private deps(args: { sessionId: string; onDrop?: (() => void) | undefined }): HeldSessionDeps {
    return {
      sessionId: args.sessionId,
      plane: this.plane,
      bus: this.bus,
      timers: this.timers,
      ids: this.ids,
      appendRetryMs: this.appendRetryMs,
      idleMinutes: this.idleMinutes,
      runtimeFor: this.runtimes,
      ...(args.onDrop === undefined ? {} : { onDrop: args.onDrop }),
      log: this.log,
    }
  }
}
