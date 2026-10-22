import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { EPrFrameKind, type PrFrame, parsePrFrame } from './github-pr-fanout.frame'
import { LocalPrFrameBus, PrFrameBus } from './github-pr-fanout.transport'
import type { GithubPrEventDto, GithubPrStateDto } from './github-realtime.types'

type PrStateHandler = (state: GithubPrStateDto) => void
type PrEventHandler = (event: GithubPrEventDto) => void
type EventDeliveredHandler = (args: { ackId: string; userId: string }) => void

const COALESCE_WINDOW_MS = 1_000

type PendingPush = { state: GithubPrStateDto; userIds: readonly string[]; dirty: boolean }
type PendingEventPush = {
  event: GithubPrEventDto
  userIds: readonly string[]
  dirty: boolean
  ackId?: string | undefined
}

type OpenStream = {
  handler: PrStateHandler
  eventHandler: PrEventHandler | undefined
  onClosed: (() => void) | undefined
}

/**
 * Coalescing stays local: the first push for a PR flushes immediately, and pushes inside the
 * following one-second window collapse to the latest state, so a check_run storm emits at most
 * one follow-up frame. A flush publishes one frame on the bus and every instance's subscriber
 * delivers it to the streams it holds, so a stream reaches events pushed on any instance. With
 * no bus configured the flush delivers directly. On drain every open stream is closed outright:
 * the client reconnects and re-reads state instead of a frame riding a dying process.
 */
@Injectable()
export class GithubPrFanoutService implements OnModuleDestroy {
  private readonly logger = new Logger(GithubPrFanoutService.name)
  private readonly streams = new Map<string, Set<OpenStream>>()
  private readonly pending = new Map<string, PendingPush>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly pendingEvents = new Map<string, PendingEventPush>()
  private readonly eventTimers = new Map<string, NodeJS.Timeout>()
  private readonly deliveredHandlers = new Set<EventDeliveredHandler>()
  private subscribed = false

  constructor(
    drain: DrainStateService,
    private readonly bus: PrFrameBus = new LocalPrFrameBus(),
  ) {
    drain.onDrain(() => this.closeAll())
  }

  onEventDelivered(handler: EventDeliveredHandler): void {
    this.deliveredHandlers.add(handler)
  }

  async onModuleDestroy(): Promise<void> {
    this.closeAll()
    await this.bus.close()
  }

  openStream(args: {
    userId: string
    handler: PrStateHandler
    eventHandler?: PrEventHandler
    onClosed?: () => void
  }): () => void {
    const entry: OpenStream = {
      handler: args.handler,
      eventHandler: args.eventHandler,
      onClosed: args.onClosed,
    }
    let handlers = this.streams.get(args.userId)
    if (handlers === undefined) {
      handlers = new Set()
      this.streams.set(args.userId, handlers)
    }
    handlers.add(entry)
    this.ensureSubscribed()
    return () => {
      handlers.delete(entry)
      if (handlers.size === 0) this.streams.delete(args.userId)
    }
  }

  private ensureSubscribed(): void {
    if (this.subscribed) return
    this.subscribed = true
    this.bus.subscribe({ onMessage: (raw) => this.handleFrame({ raw }) })
  }

  closeAll(): void {
    const entries = [...this.streams.values()].flatMap((handlers) => [...handlers])
    this.streams.clear()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.pending.clear()
    for (const timer of this.eventTimers.values()) clearTimeout(timer)
    this.eventTimers.clear()
    this.pendingEvents.clear()
    this.subscribed = false
    void this.bus.close().catch((failure: unknown) => {
      this.logger.warn(`closing the pr frame subscriber failed: ${String(failure)}`)
    })
    for (const entry of entries) {
      try {
        entry.onClosed?.()
      } catch (failure) {
        this.logger.warn(`closing a stream for drain failed: ${String(failure)}`)
      }
    }
  }

  push(args: { userIds: readonly string[]; state: GithubPrStateDto }): void {
    const key = `${args.state.repoFullName}#${args.state.prNumber}`
    const held = this.pending.get(key)

    if (held === undefined) {
      this.pending.set(key, { state: args.state, userIds: args.userIds, dirty: false })
      this.flushState(args)
      this.openWindow({ key })
      return
    }

    this.pending.set(key, { state: args.state, userIds: args.userIds, dirty: true })
  }

  /**
   * Same coalescing shape as `push`, keyed per (repo, pr, kind): the first event flushes
   * immediately, and a burst of the same kind inside the one-second window collapses to the
   * latest — a re-push storm must not turn into an event storm.
   */
  pushEvent(args: { userIds: readonly string[]; event: GithubPrEventDto; ackId?: string }): void {
    const key = `${args.event.repoFullName}#${args.event.prNumber}#${args.event.kind}#${[...args.userIds].sort().join(',')}`
    const held = this.pendingEvents.get(key)

    if (held === undefined) {
      this.pendingEvents.set(key, {
        event: args.event,
        userIds: args.userIds,
        dirty: false,
        ackId: args.ackId,
      })
      this.flushEvents(args)
      this.openEventWindow({ key })
      return
    }

    this.pendingEvents.set(key, {
      event: args.event,
      userIds: args.userIds,
      dirty: true,
      ackId: args.ackId,
    })
  }

  private openEventWindow(args: { key: string }): void {
    const prior = this.eventTimers.get(args.key)
    if (prior !== undefined) clearTimeout(prior)
    const timer = setTimeout(() => {
      this.eventTimers.delete(args.key)
      const held = this.pendingEvents.get(args.key)
      this.pendingEvents.delete(args.key)
      if (held?.dirty) {
        this.flushEvents({
          userIds: held.userIds,
          event: held.event,
          ...(held.ackId === undefined ? {} : { ackId: held.ackId }),
        })
      }
    }, COALESCE_WINDOW_MS)
    this.eventTimers.set(args.key, timer)
  }

  private flushEvents(args: {
    userIds: readonly string[]
    event: GithubPrEventDto
    ackId?: string
  }): void {
    this.dispatch({
      frame: {
        kind: EPrFrameKind.Event,
        userIds: args.userIds,
        payload: args.event,
        ...(args.ackId === undefined ? {} : { ackId: args.ackId }),
      },
    })
  }

  private openWindow(args: { key: string }): void {
    const prior = this.timers.get(args.key)
    if (prior !== undefined) clearTimeout(prior)
    const timer = setTimeout(() => {
      this.timers.delete(args.key)
      const held = this.pending.get(args.key)
      this.pending.delete(args.key)
      if (held?.dirty) this.flushState({ userIds: held.userIds, state: held.state })
    }, COALESCE_WINDOW_MS)
    this.timers.set(args.key, timer)
  }

  private flushState(args: { userIds: readonly string[]; state: GithubPrStateDto }): void {
    this.dispatch({
      frame: { kind: EPrFrameKind.State, userIds: args.userIds, payload: args.state },
    })
  }

  private dispatch(args: { frame: PrFrame }): void {
    if (!this.bus.distributed) {
      this.deliver({ frame: args.frame })
      return
    }
    this.bus.publish({ frame: args.frame }).catch((failure: unknown) => {
      this.logger.warn(`publishing a pr frame failed, dropping it: ${String(failure)}`)
    })
  }

  private handleFrame(args: { raw: string }): void {
    const frame = parsePrFrame({ raw: args.raw })
    if (frame === undefined) {
      this.logger.warn('ignoring a malformed pr frame')
      return
    }
    this.deliver({ frame })
  }

  private deliver(args: { frame: PrFrame }): void {
    for (const userId of args.frame.userIds) {
      const handlers = this.streams.get(userId)
      if (handlers === undefined) continue
      if (args.frame.kind === EPrFrameKind.State) {
        this.deliverState({ userId, handlers, state: args.frame.payload })
        continue
      }
      const delivered = this.deliverEvent({ userId, handlers, event: args.frame.payload })
      if (delivered && args.frame.ackId !== undefined) {
        this.acknowledge({ ackId: args.frame.ackId, userId })
      }
    }
  }

  private deliverState(args: {
    userId: string
    handlers: Set<OpenStream>
    state: GithubPrStateDto
  }): void {
    for (const entry of args.handlers) {
      try {
        entry.handler(args.state)
      } catch (failure) {
        this.logger.warn(`a stream handler failed for ${args.userId}: ${String(failure)}`)
      }
    }
  }

  private deliverEvent(args: {
    userId: string
    handlers: Set<OpenStream>
    event: GithubPrEventDto
  }): boolean {
    let delivered = false
    for (const entry of args.handlers) {
      if (entry.eventHandler === undefined) continue
      try {
        entry.eventHandler(args.event)
        delivered = true
      } catch (failure) {
        this.logger.warn(`an event handler failed for ${args.userId}: ${String(failure)}`)
      }
    }
    return delivered
  }

  private acknowledge(args: { ackId: string; userId: string }): void {
    for (const handler of this.deliveredHandlers) {
      try {
        handler(args)
      } catch (failure) {
        this.logger.warn(`an event delivered hook failed for ${args.userId}: ${String(failure)}`)
      }
    }
  }
}
