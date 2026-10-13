import { Injectable, Logger } from '@nestjs/common'
import { DrainStateService } from '../../platform/health/drain-state.service'
import type { UserFileChange, UserFileTree } from './user-files.types'

type ChangeHandler = (change: UserFileChange) => void

type OpenStream = {
  tree: UserFileTree | undefined
  handler: ChangeHandler
  onClosed: (() => void) | undefined
}

@Injectable()
export class UserFilesFanoutService {
  private readonly logger = new Logger(UserFilesFanoutService.name)
  private readonly streams = new Map<string, Set<OpenStream>>()

  constructor(drain: DrainStateService) {
    drain.onDrain(() => this.closeAll())
  }

  openStream(args: {
    userId: string
    tree?: UserFileTree | undefined
    handler: ChangeHandler
    onClosed?: () => void
  }): () => void {
    const entry: OpenStream = { tree: args.tree, handler: args.handler, onClosed: args.onClosed }
    let entries = this.streams.get(args.userId)
    if (entries === undefined) {
      entries = new Set()
      this.streams.set(args.userId, entries)
    }
    entries.add(entry)
    return () => {
      entries.delete(entry)
      if (entries.size === 0) this.streams.delete(args.userId)
    }
  }

  publish(args: { userId: string; change: UserFileChange }): void {
    const entries = this.streams.get(args.userId)
    if (entries === undefined) return
    for (const entry of entries) {
      if (entry.tree !== undefined && entry.tree !== args.change.tree) continue
      try {
        entry.handler(args.change)
      } catch (failure) {
        this.logger.warn(`a stream handler failed for ${args.userId}: ${String(failure)}`)
      }
    }
  }

  closeAll(): void {
    const entries = [...this.streams.values()].flatMap((open) => [...open])
    this.streams.clear()
    for (const entry of entries) {
      try {
        entry.onClosed?.()
      } catch (failure) {
        this.logger.warn(`closing a stream for drain failed: ${String(failure)}`)
      }
    }
  }
}
