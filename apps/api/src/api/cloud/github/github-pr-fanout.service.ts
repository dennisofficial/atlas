import { Injectable, Logger } from '@nestjs/common'
import { DrainStateService } from '../../platform/health/drain-state.service'
import type { GithubPrStateDto } from './github-realtime.types'

type PrStateHandler = (state: GithubPrStateDto) => void

const COALESCE_WINDOW_MS = 1_000

type PendingPush = { state: GithubPrStateDto; userIds: readonly string[]; dirty: boolean }

type OpenStream = { handler: PrStateHandler; onClosed: (() => void) | undefined }

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

  constructor(drain: DrainStateService) {
    drain.onDrain(() => this.closeAll())
  }

  openStream(args: {
    userId: string
    handler: PrStateHandler
    onClosed?: () => void
  }): () => void {
    const entry: OpenStream = { handler: args.handler, onClosed: args.onClosed }
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
