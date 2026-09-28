import { Injectable, Logger } from '@nestjs/common'
import type { GithubPrStateDto } from './github-realtime.types'

type PrStateHandler = (state: GithubPrStateDto) => void

const COALESCE_WINDOW_MS = 1_000

/**
 * The in-process fan-out seam named in the spec's fallback table: one publisher interface per
 * live SSE stream, replaced by a cross-process channel (LISTEN/NOTIFY) when a second API
 * instance ships. Pushes coalesce per PR within a one-second window so a check_run storm emits
 * only the latest state.
 */
@Injectable()
export class GithubPrFanoutService {
  private readonly logger = new Logger(GithubPrFanoutService.name)
  private readonly streams = new Map<string, Set<PrStateHandler>>()
  private readonly pending = new Map<string, { state: GithubPrStateDto; timer: NodeJS.Timeout }>()

  openStream(args: { userId: string; handler: PrStateHandler }): () => void {
    let handlers = this.streams.get(args.userId)
    if (handlers === undefined) {
      handlers = new Set()
      this.streams.set(args.userId, handlers)
    }
    handlers.add(args.handler)
    return () => {
      handlers.delete(args.handler)
      if (handlers.size === 0) this.streams.delete(args.userId)
    }
  }

  push(args: { userIds: readonly string[]; state: GithubPrStateDto }): void {
    const key = `${args.state.repoFullName}#${args.state.prNumber}`
    const held = this.pending.get(key)
    if (held !== undefined) {
      clearTimeout(held.timer)
      this.pending.delete(key)
    }

    const timer = setTimeout(() => {
      this.pending.delete(key)
      this.flush({ userIds: args.userIds, state: args.state })
    }, COALESCE_WINDOW_MS)
    this.pending.set(key, { state: args.state, timer })
  }

  private flush(args: { userIds: readonly string[]; state: GithubPrStateDto }): void {
    for (const userId of args.userIds) {
      const handlers = this.streams.get(userId)
      if (handlers === undefined) continue
      for (const handler of handlers) {
        try {
          handler(args.state)
        } catch (failure) {
          this.logger.warn(`a stream handler failed for ${userId}: ${String(failure)}`)
        }
      }
    }
  }
}
