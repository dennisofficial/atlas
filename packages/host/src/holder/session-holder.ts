import { EHeldOutcome, toThreadId, type HeldOutcome, type Lease } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { HostBus } from './ports'
import { ClaimLoop } from './claim-loop'
import { HolderDemand } from './holder-demand'
import { PodCalls } from './pod-calls'
import { HolderPods } from './pod-route/holder-pods'
import type { PodRouter } from './pod-route/pod-router'
import { HeldSession, type HeldSessionDeps } from './held-session'
import { heldSessionDepsOf } from './held-deps'
import { HolderPresence } from './holder-presence'
import { auditOwnLeases } from './own-lease-audit'
import { runHeld } from './run-held'
import { LeaseSettler } from './settle'
import { SESSION_HOLDER_DEFAULTS as DEFAULTS, type SessionHolderArgs } from './session-holder-args'

export class SessionHolder {
  private readonly presence: HolderPresence
  private readonly plane: ControlPlane
  private readonly bus: HostBus
  private readonly log: LogPort | undefined
  private readonly args: SessionHolderArgs

  private readonly held = new Map<string, HeldSession>()
  private readonly demand: HolderDemand
  private readonly pods: HolderPods
  private readonly retryAt = new Map<string, string | null>()
  private lostRetries: (string | null)[] = []
  private unsubWake: (() => void) | undefined
  private unsubResync: (() => void) | undefined
  private readonly loop: ClaimLoop
  private readonly settler: LeaseSettler
  private readonly running = new Set<Promise<void>>()
  private draining = false

  constructor(args: SessionHolderArgs) {
    this.args = args
    this.presence = new HolderPresence({
      presence: args.presence,
      timers: args.timers,
      log: args.log,
      onLost: (hostId) => this.handlePresenceLost(hostId),
      onRegistered: () => this.handleRegistered(),
      onChanged: args.onHostIdChanged,
    })
    this.plane = args.plane
    this.bus = args.bus
    this.demand = new HolderDemand({
      plane: args.plane,
      bus: args.bus,
      timers: args.timers,
      holds: (sessionId) => this.held.has(sessionId),
      draining: () => this.draining,
      onReconcile: (sessionId) => this.onWake(sessionId),
      terminal: args.terminalDemand,
      panel: args.panelDemand,
      log: args.log,
    })
    this.log = args.log
    this.pods = new HolderPods({
      calls: this.podCalls(),
      demand: this.demand,
      plane: args.plane,
      bus: args.podCallBus,
      hostId: () => this.hostId(),
      runtimeOpen: (sessionId) => this.held.get(sessionId)?.runtimeOf() !== undefined,
      holds: (sessionId) => this.held.has(sessionId),
      timers: args.timers,
      log: args.log,
    })
    this.settler = new LeaseSettler({
      plane: args.plane,
      timers: args.timers,
      log: args.log,
      ring: () => this.loop.ring(),
      ringAt: (isoTime) => this.loop.ringAt(isoTime),
    })
    this.loop = new ClaimLoop({
      timers: args.timers,
      tickMs: args.sweepMs ?? DEFAULTS.sweepMs,
      hostId: () => this.presence.current(),
      draining: () => this.draining,
      claimNext: (claim) => this.plane.claimNext(claim),
      hold: (lease) => this.hold(lease),
      onTick: () => this.handleTick(),
      settlePending: () => this.settler.retryPending(),
      log: args.log,
    })
  }

  async start(): Promise<void> {
    await this.presence.start()
    this.pods.start()
    this.unsubWake = this.bus.onWake((sessionId) => {
      this.onWake(sessionId)
    })
    this.unsubResync = this.bus.onResync(() => this.onResync())
    this.loop.start()
  }

  async drain(): Promise<void> {
    this.draining = true
    this.pods.beginDrain()
    this.stopTriggers()
    const sessions = [...this.held.values()]
    for (const session of sessions) session.beginDrain()
    await Promise.all(
      sessions.map((session) =>
        session.handoff().catch((error) => {
          this.log?.error({
            source: 'holder.drain',
            message: `handing off ${session.sessionId} failed`,
            ...logFieldsOf({ error }),
          })
        }),
      ),
    )
    this.pods.stop()
  }

  private stopTriggers(): void {
    this.unsubWake?.()
    this.unsubResync?.()
    this.demand.stop()
    this.presence.stop()
    this.loop.stop()
  }

  hostId(): number | undefined {
    return this.presence.current()
  }

  ring(): void {
    this.loop.ring()
  }

  heldIds(): readonly string[] {
    return [...this.held.keys()]
  }

  podCalls(): PodCalls {
    return new PodCalls({ held: (sessionId) => this.held.get(sessionId)?.runtimeOf() })
  }

  podRouter(): PodRouter {
    return this.pods.router
  }

  demandOf(): HolderDemand {
    return this.demand
  }

  discard(): void {
    this.draining = true
    this.pods.stop()
    this.stopTriggers()
    this.demand.panel.stop()
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
    this.settler.clear()
    this.lostRetries = [...this.retryAt.values()]
    this.retryAt.clear()
    for (const session of sessions) session.losePresence()
  }

  private onWake(sessionId: string): void {
    if (this.draining) return
    const held = this.held.get(sessionId)
    if (held !== undefined) return held.notifyWake()
    this.loop.ring()
  }

  private handleRegistered(): void {
    for (const retryAfter of this.lostRetries.splice(0)) this.loop.ringAt(retryAfter)
    this.onResync()
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
      isRunning: (sessionId) => this.held.has(sessionId) || this.settler.has(sessionId),
      settle: (args) => this.settler.settle(args),
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
      await this.settler.settle({
        lease,
        outcome: { kind: EHeldOutcome.Drained, needsHolder: true },
      })
      return
    }
    const session = new HeldSession(
      this.deps({ lease, podSessionId: row.podSessionId ?? row.sessionId }),
    )
    this.held.set(lease.sessionId, session)
    this.retryAt.set(lease.sessionId, lease.retryAfter)
    const finished = this.runAndSettle({
      session,
      lease,
      threadId: toThreadId(row.mainThreadId),
      claimMs: args.claimMs,
    }).finally(() => this.running.delete(finished))
    this.running.add(finished)
  }

  private async runAndSettle(args: {
    session: HeldSession
    lease: Lease
    threadId: ReturnType<typeof toThreadId>
    claimMs: number
  }): Promise<void> {
    const { session, lease } = args
    const outcome: HeldOutcome = await runHeld({ ...args, log: this.log })
    if (this.held.get(lease.sessionId) === session) this.held.delete(lease.sessionId)
    this.retryAt.delete(lease.sessionId)
    await this.settler.settle({ lease, outcome })
  }

  private deps(args: { lease: Lease; podSessionId: string }): HeldSessionDeps {
    return heldSessionDepsOf({
      args: this.args,
      onRuntimeReady: (sessionId) => this.pods.ready(sessionId),
      ...args,
    })
  }
}
