import { toThreadId, type IdPort, type Lease } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { HostBus, HostPresence, HostTimers, SessionRuntimeFactory } from './ports'
import { HeldSession, type HeldSessionDeps } from './held-session'
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
  log?: LogPort | undefined
}

const RESYNC_RETRY_BASE_MS = 250
const RESYNC_RETRY_CAP_MS = 5_000

const DEFAULTS = {
  appendRetryMs: DEFAULT_APPEND_RETRY_MS,
  idleMinutes: 30,
} as const

export class SessionHolder {
  private readonly presence: HostPresence
  private hostId: number | undefined
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
  private resyncRetryTimer: unknown
  private resyncFailures = 0
  private draining = false

  constructor(args: SessionHolderArgs) {
    this.presence = args.presence
    this.plane = args.plane
    this.bus = args.bus
    this.timers = args.timers
    this.runtimes = args.runtimes
    this.ids = args.ids
    this.maxSessions = args.maxSessions
    this.appendRetryMs = args.appendRetryMs ?? DEFAULTS.appendRetryMs
    this.idleMinutes = args.idleMinutes ?? DEFAULTS.idleMinutes
    this.log = args.log
  }

  async start(): Promise<void> {
    this.hostId = await this.presence.register()
    this.unsubWake = this.bus.onWake((sessionId) => {
      this.onWake(sessionId)
    })
    this.unsubResync = this.bus.onResync(() => {
      void this.onResync()
    })
  }

  async drain(args: { deadline: number }): Promise<void> {
    this.draining = true
    this.unsubWake?.()
    this.unsubResync?.()
    this.cancelResyncRetry()
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

  heldIds(): readonly string[] {
    return [...this.held.keys()]
  }

  discard(): void {
    this.draining = true
    this.unsubWake?.()
    this.unsubResync?.()
    this.cancelResyncRetry()
    for (const session of this.held.values()) session.discard()
  }

  private onWake(sessionId: string): void {
    if (this.draining) return
    const held = this.held.get(sessionId)
    if (held !== undefined) {
      held.notifyWake()
      return
    }
    if (this.pendingClaims.has(sessionId)) return
    if (this.held.size + this.pendingClaims.size >= this.maxSessions) return
    const pending = this.claimAndHold(sessionId).finally(() => {
      this.pendingClaims.delete(sessionId)
    })
    this.pendingClaims.set(sessionId, pending)
    pending.catch(() => undefined)
  }

  private async onResync(): Promise<void> {
    if (this.draining) return
    for (const session of this.held.values()) session.notifyWake()
    let ids: string[]
    try {
      ids = await this.plane.sessionsNeedingHolder({ limit: this.maxSessions })
    } catch (error) {
      this.log?.error({
        source: 'holder.resync',
        message: 'listing sessions needing a holder failed',
        ...logFieldsOf({ error }),
      })
      this.scheduleResyncRetry()
      return
    }
    this.resyncFailures = 0
    for (const sessionId of ids) this.onWake(sessionId)
  }

  private scheduleResyncRetry(): void {
    if (this.draining || this.resyncRetryTimer !== undefined) return
    const delay = Math.min(RESYNC_RETRY_BASE_MS * 2 ** this.resyncFailures, RESYNC_RETRY_CAP_MS)
    this.resyncFailures += 1
    this.resyncRetryTimer = this.timers.setTimeout(() => {
      this.resyncRetryTimer = undefined
      void this.onResync()
    }, delay)
  }

  private cancelResyncRetry(): void {
    if (this.resyncRetryTimer === undefined) return
    this.timers.clearTimeout(this.resyncRetryTimer)
    this.resyncRetryTimer = undefined
  }

  private async claimAndHold(sessionId: string): Promise<void> {
    try {
      const claimStartedAt = this.timers.now()
      if (this.hostId === undefined) return
      const claim = await this.plane.claim({ sessionId, hostId: this.hostId })
      if (!claim.ok) return
      if (this.draining) {
        await this.plane
          .revoke({ sessionId, wantsHolder: true, epoch: claim.lease.epoch })
          .catch(() => undefined)
        return
      }
      await this.hold({
        sessionId,
        lease: claim.lease,
        claimMs: this.timers.now() - claimStartedAt,
      })
    } catch (error) {
      this.log?.error({
        source: 'holder.claim',
        message: `claiming ${sessionId} failed`,
        ...logFieldsOf({ error }),
      })
    }
  }

  private async hold(args: { sessionId: string; lease: Lease; claimMs: number }): Promise<void> {
    const row = await this.plane.readSession({ sessionId: args.sessionId })
    if (row === undefined) return
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
