import { Injectable, Logger } from '@nestjs/common'
import { DrainStateService } from '../../platform/health/drain-state.service'
import type { GithubPrEventDto, GithubPrStateDto } from './github-realtime.types'

type PrStateHandler = (state: GithubPrStateDto) => void
type PrEventHandler = (event: GithubPrEventDto) => void

const COALESCE_WINDOW_MS = 1_000

type PendingPush = { state: GithubPrStateDto; userIds: readonly string[]; dirty: boolean }
type PendingEventPush = { event: GithubPrEventDto; userIds: readonly string[]; dirty: boolean }

type OpenStream = {
  handler: PrStateHandler
  eventHandler: PrEventHandler | undefined
  onClosed: (() => void) | undefined
}

/**
 * The in-process fan-out seam named in the spec's fallback table: one publisher interface per
 * live SSE stream, replaced by a cross-process channel (LISTEN/NOTIFY) when a second API
 * instance ships. The first push for a PR flushes immediately; pushes inside the following
 * one-second window coalesce to the latest state, so a check_run storm emits at most one
 * follow-up frame. On drain every open stream is closed outright: a redeploy is exactly when a
 * frame would otherwise ride the old process into the void, and a closed stream forces the
 * client to reconnect to the new instance and re-read state.
 */
@Injectable()
export class GithubPrFanoutService {
  private readonly logger = new Logger(GithubPrFanoutService.name)
  private readonly streams = new Map<string, Set<OpenStream>>()
  private readonly pending = new Map<string, PendingPush>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly pendingEvents = new Map<string, PendingEventPush>()
  private readonly eventTimers = new Map<string, NodeJS.Timeout>()

  constructor(drain: DrainStateService) {
    drain.onDrain(() => this.closeAll())
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
    return () => {
      handlers.delete(entry)
      if (handlers.size === 0) this.streams.delete(args.userId)
    }
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
      this.flush(args)
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
  pushEvent(args: { userIds: readonly string[]; event: GithubPrEventDto }): void {
    const key = `${args.event.repoFullName}#${args.event.prNumber}#${args.event.kind}#${[...args.userIds].sort().join(',')}`
    const held = this.pendingEvents.get(key)

    if (held === undefined) {
      this.pendingEvents.set(key, { event: args.event, userIds: args.userIds, dirty: false })
      this.flushEvents(args)
      this.openEventWindow({ key })
      return
    }

    this.pendingEvents.set(key, { event: args.event, userIds: args.userIds, dirty: true })
  }

  private openEventWindow(args: { key: string }): void {
    const prior = this.eventTimers.get(args.key)
    if (prior !== undefined) clearTimeout(prior)
    const timer = setTimeout(() => {
      this.eventTimers.delete(args.key)
      const held = this.pendingEvents.get(args.key)
      this.pendingEvents.delete(args.key)
      if (held?.dirty) this.flushEvents({ userIds: held.userIds, event: held.event })
    }, COALESCE_WINDOW_MS)
    this.eventTimers.set(args.key, timer)
  }

  private flushEvents(args: { userIds: readonly string[]; event: GithubPrEventDto }): void {
    for (const userId of args.userIds) {
      const handlers = this.streams.get(userId)
      if (handlers === undefined) continue
      for (const entry of handlers) {
        if (entry.eventHandler === undefined) continue
        try {
          entry.eventHandler(args.event)
        } catch (failure) {
          this.logger.warn(`an event handler failed for ${userId}: ${String(failure)}`)
        }
      }
    }
  }

  private openWindow(args: { key: string }): void {
    const prior = this.timers.get(args.key)
    if (prior !== undefined) clearTimeout(prior)
    const timer = setTimeout(() => {
      this.timers.delete(args.key)
      const held = this.pending.get(args.key)
      this.pending.delete(args.key)
      if (held?.dirty) this.flush({ userIds: held.userIds, state: held.state })
    }, COALESCE_WINDOW_MS)
    this.timers.set(args.key, timer)
  }

  private flush(args: { userIds: readonly string[]; state: GithubPrStateDto }): void {
    for (const userId of args.userIds) {
      const handlers = this.streams.get(userId)
      if (handlers === undefined) continue
      for (const entry of handlers) {
        try {
          entry.handler(args.state)
        } catch (failure) {
          this.logger.warn(`a stream handler failed for ${userId}: ${String(failure)}`)
        }
      }
    }
  }
}
