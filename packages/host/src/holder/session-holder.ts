import { toThreadId, type IdPort, type Lease } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { HostBus, HostTimers, SessionRuntimeFactory } from './ports'
import { HeldSession, type HeldSessionDeps } from './held-session'

export type SessionHolderArgs = {
  holderId: string
  plane: ControlPlane
  bus: HostBus
  timers: HostTimers
  runtimes: SessionRuntimeFactory
  ids: IdPort
  maxSessions: number
  ttlMs?: number | undefined
  renewEveryMs?: number | undefined
  fenceMarginMs?: number | undefined
  inboxPollMs?: number | undefined
  idleMinutes?: number | undefined
  log?: LogPort | undefined
}

const DEFAULTS = {
  ttlMs: 30_000,
  renewEveryMs: 5_000,
  fenceMarginMs: 5_000,
  inboxPollMs: 2_000,
  idleMinutes: 30,
} as const

export class SessionHolder {
  private readonly holderId: string
  private readonly plane: ControlPlane
  private readonly bus: HostBus
  private readonly timers: HostTimers
  private readonly runtimes: SessionRuntimeFactory
  private readonly ids: IdPort
  private readonly maxSessions: number
  private readonly ttlMs: number
  private readonly renewEveryMs: number
  private readonly fenceMarginMs: number
  private readonly inboxPollMs: number
  private readonly idleMinutes: number
  private readonly log: LogPort | undefined

  private readonly held = new Map<string, HeldSession>()
  private readonly pendingClaims = new Map<string, Promise<void>>()
  private unsubWake: (() => void) | undefined
  private draining = false

  constructor(args: SessionHolderArgs) {
    this.holderId = args.holderId
    this.plane = args.plane
    this.bus = args.bus
    this.timers = args.timers
    this.runtimes = args.runtimes
    this.ids = args.ids
    this.maxSessions = args.maxSessions
    this.ttlMs = args.ttlMs ?? DEFAULTS.ttlMs
    this.renewEveryMs = args.renewEveryMs ?? DEFAULTS.renewEveryMs
    this.fenceMarginMs = args.fenceMarginMs ?? DEFAULTS.fenceMarginMs
    this.inboxPollMs = args.inboxPollMs ?? DEFAULTS.inboxPollMs
    this.idleMinutes = args.idleMinutes ?? DEFAULTS.idleMinutes
    this.log = args.log
  }

  async start(): Promise<void> {
    this.unsubWake = this.bus.onWake((sessionId) => {
      void this.onWake(sessionId)
    })
  }

  async drain(args: { deadline: number }): Promise<void> {
    this.draining = true
    this.unsubWake?.()
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
    for (const session of this.held.values()) session.discard()
  }

  private onWake(sessionId: string): void {
    if (this.draining) return
    if (this.held.has(sessionId)) return
    if (this.pendingClaims.has(sessionId)) return
    if (this.held.size + this.pendingClaims.size >= this.maxSessions) return
    const pending = this.claimAndHold(sessionId).finally(() => {
      this.pendingClaims.delete(sessionId)
    })
    this.pendingClaims.set(sessionId, pending)
    pending.catch(() => undefined)
  }

  private async claimAndHold(sessionId: string): Promise<void> {
    try {
      const claim = await this.plane.claim({
        sessionId,
        holderId: this.holderId,
        ttlMs: this.ttlMs,
      })
      if (!claim.ok) return
      if (this.draining) {
        await this.plane
          .revoke({ sessionId, wantsHolder: true, epoch: claim.lease.epoch })
          .catch(() => undefined)
        await this.bus.wake(sessionId).catch(() => undefined)
        return
      }
      await this.hold({ sessionId, lease: claim.lease })
    } catch (error) {
      this.log?.error({
        source: 'holder.claim',
        message: `claiming ${sessionId} failed`,
        ...logFieldsOf({ error }),
      })
    }
  }

  private async hold(args: { sessionId: string; lease: Lease }): Promise<void> {
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
    const done = session.run({ lease: args.lease, threadId: toThreadId(row.mainThreadId) })
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
      holderId: this.holderId,
      plane: this.plane,
      bus: this.bus,
      timers: this.timers,
      ids: this.ids,
      ttlMs: this.ttlMs,
      renewEveryMs: this.renewEveryMs,
      fenceMarginMs: this.fenceMarginMs,
      inboxPollMs: this.inboxPollMs,
      idleMinutes: this.idleMinutes,
      runtimeFor: this.runtimes,
      ...(args.onDrop === undefined ? {} : { onDrop: args.onDrop }),
      log: this.log,
    }
  }
}
