import { startVerdict, toThreadId, type IdPort, type Lease } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { HostBus, HostPresence, HostTimers, SessionRuntimeFactory } from './ports'
import { ClaimLoop } from './claim-loop'
import { HeldSession, type HeldSessionDeps } from './held-session'
import { HolderPresence } from './holder-presence'
import { auditOwnLeases } from './own-lease-audit'
import { DEFAULT_APPEND_RETRY_MS } from './record/retry-deadline'

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
  isPermanentStartError?: ((error: unknown) => boolean) | undefined
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
  private readonly isPermanentStartError: (error: unknown) => boolean
  private readonly log: LogPort | undefined

  private readonly held = new Map<string, HeldSession>()
  private unsubWake: (() => void) | undefined
  private unsubResync: (() => void) | undefined
  private readonly loop: ClaimLoop
  private draining = false

  constructor(args: SessionHolderArgs) {
    this.presence = new HolderPresence({
      presence: args.presence,
      timers: args.timers,
      log: args.log,
      onLost: (hostId) => this.handlePresenceLost(hostId),
      onRegistered: () => this.onResync(),
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
    this.isPermanentStartError = args.isPermanentStartError ?? (() => false)
    this.log = args.log
    this.loop = new ClaimLoop({
      timers: args.timers,
      tickMs: args.sweepMs ?? DEFAULTS.sweepMs,
      hostId: () => this.presence.current(),
      draining: () => this.draining,
      freeSlots: () => this.maxSessions - this.held.size,
      claimNext: (claim) => this.plane.claimNext(claim),
      hold: (lease) => this.hold(lease),
      onTick: () => this.handleTick(),
      log: args.log,
    })
  }

  async start(): Promise<void> {
    await this.presence.start()
    this.unsubWake = this.bus.onWake((sessionId) => {
      this.onWake(sessionId)
    })
    this.unsubResync = this.bus.onResync(() => this.onResync())
    this.loop.start()
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
    this.loop.stop()
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
    if (held !== undefined) return held.notifyWake()
    this.loop.ring()
  }

  private onResync(): void {
    if (this.draining) return
    for (const session of this.held.values()) session.notifyWake()
    this.loop.ring()
  }

  private superseded(hostId: number | undefined): boolean {
    return hostId !== undefined && !this.draining && hostId !== this.presence.current()
  }

  private async handleTick(): Promise<void> {
    for (const session of this.held.values()) session.notifyWake()
    const hostId = this.presence.current()
    if (this.draining || hostId === undefined) return
    await auditOwnLeases({
      plane: this.plane,
      hostId,
      isRunning: (sessionId) => this.held.has(sessionId),
      log: this.log,
    })
  }

  private async hold(args: { hostId: number; lease: Lease; claimMs: number }): Promise<void> {
    const { lease } = args
    const row =
      this.superseded(args.hostId) || this.draining
        ? undefined
        : await this.plane.readSession({ sessionId: lease.sessionId })
    if (row === undefined || this.draining || this.superseded(args.hostId)) {
      await this.plane
        .revoke({ sessionId: lease.sessionId, wantsHolder: true, epoch: lease.epoch })
        .catch(() => undefined)
      return
    }
    const session = new HeldSession(
      this.deps({
        lease,
        onDrop: () => {
          if (this.held.get(lease.sessionId) === session) this.held.delete(lease.sessionId)
        },
      }),
    )
    this.held.set(lease.sessionId, session)
    const done = session.run({
      lease,
      threadId: toThreadId(row.mainThreadId),
      claimMs: args.claimMs,
    })
    done.then(
      () => {
        if (this.held.get(lease.sessionId) === session) this.held.delete(lease.sessionId)
        if (session.startFailed && !this.draining) this.loop.ringAt(lease.retryAfter)
        this.loop.ring()
      },
      (error) => {
        this.log?.error({
          source: 'holder.session',
          message: `the drive of ${lease.sessionId} rejected past its guard`,
          ...logFieldsOf({ error }),
        })
        if (this.held.get(lease.sessionId) === session) this.held.delete(lease.sessionId)
        this.loop.ring()
      },
    )
  }

  private deps(args: { lease: Lease; onDrop?: (() => void) | undefined }): HeldSessionDeps {
    return {
      sessionId: args.lease.sessionId,
      plane: this.plane,
      bus: this.bus,
      timers: this.timers,
      ids: this.ids,
      appendRetryMs: this.appendRetryMs,
      idleMinutes: this.idleMinutes,
      runtimeFor: this.runtimes,
      judgeStartFailure: (error) =>
        startVerdict({
          attempts: args.lease.attempts,
          permanent: this.isPermanentStartError(error),
        }),
      ...(args.onDrop === undefined ? {} : { onDrop: args.onDrop }),
      log: this.log,
    }
  }
}
