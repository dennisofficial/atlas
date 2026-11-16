import type { Logger } from '@nestjs/common'
import type { PrStateHandler } from './github-pr-fanout.delivery'
import { prIdentity } from './github-pr-identity'
import type { GithubPrStateDto } from './github-realtime.types'

export type PrKeyWatcher = {
  handler: PrStateHandler
  onClosed: (() => void) | undefined
  keys: Set<string>
}

export type PrKeyWatch = {
  setKeys: (keys: readonly string[]) => void
  close: () => void
}

export class PrKeyWatchers {
  private readonly index = new Map<string, Set<PrKeyWatcher>>()
  private readonly entries = new Set<PrKeyWatcher>()

  watch(args: { handler: PrStateHandler; onClosed?: () => void }): PrKeyWatch {
    const watcher: PrKeyWatcher = {
      handler: args.handler,
      onClosed: args.onClosed,
      keys: new Set(),
    }
    this.entries.add(watcher)
    const setKeys = (keys: readonly string[]): void => {
      const next = new Set(keys)
      for (const key of watcher.keys) if (!next.has(key)) this.detach({ key, watcher })
      for (const key of next) if (!watcher.keys.has(key)) this.attach({ key, watcher })
      watcher.keys = next
    }
    const close = (): void => {
      for (const key of [...watcher.keys]) this.detach({ key, watcher })
      watcher.keys.clear()
      this.entries.delete(watcher)
    }
    return { setKeys, close }
  }

  deliver(args: {
    state: GithubPrStateDto
    skip: ReadonlySet<PrStateHandler>
    logger: Logger
  }): void {
    const watchers = this.index.get(prIdentity(args.state))
    if (watchers === undefined) return
    const handled = new Set<PrStateHandler>()
    for (const watcher of watchers) {
      if (args.skip.has(watcher.handler) || handled.has(watcher.handler)) continue
      handled.add(watcher.handler)
      try {
        watcher.handler(args.state)
      } catch (failure) {
        args.logger.warn(`a pr key watcher failed: ${String(failure)}`)
      }
    }
  }

  closeAll(args: { logger: Logger }): void {
    const watchers = [...this.entries]
    this.entries.clear()
    this.index.clear()
    for (const watcher of watchers) {
      watcher.keys.clear()
      try {
        watcher.onClosed?.()
      } catch (failure) {
        args.logger.warn(`closing a pr key watcher failed: ${String(failure)}`)
      }
    }
  }

  private attach(args: { key: string; watcher: PrKeyWatcher }): void {
    const held = this.index.get(args.key)
    if (held === undefined) {
      this.index.set(args.key, new Set([args.watcher]))
      return
    }
    held.add(args.watcher)
  }

  private detach(args: { key: string; watcher: PrKeyWatcher }): void {
    const held = this.index.get(args.key)
    if (held === undefined) return
    held.delete(args.watcher)
    if (held.size === 0) this.index.delete(args.key)
  }
}
