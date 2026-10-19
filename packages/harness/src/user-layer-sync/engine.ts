import { LogPort, type NoticePort } from '@dltech/atlas-core'

import type { UserLayerSyncClient } from './client'
import type { TreeSyncContext } from './context'
import type { TreeLayout } from './layout'
import { warnSync } from './log'
import { UserLayerSyncPort } from './port'
import { pullTree } from './pull'
import { pushTree } from './push'
import { UserLayerState } from './state'
import { watchUserLayer, type UserLayerWatchHandle } from './watcher'

export type UserLayerSyncEngineArgs = {
  client: UserLayerSyncClient
  trees: readonly TreeLayout[]
  stateFile: string
  log: LogPort
  notice?: NoticePort | undefined
  debounceMs?: number | undefined
}

export class UserLayerSyncEngine extends UserLayerSyncPort {
  private state: UserLayerState | null = null
  private watcher: UserLayerWatchHandle | null = null
  private starting: Promise<void> | null = null
  private queue: Promise<void> = Promise.resolve()
  private applying = false
  private missedWhileApplying = false
  private stopped = false

  constructor(private readonly args: UserLayerSyncEngineArgs) {
    super()
  }

  start(): Promise<void> {
    this.starting ??= this.boot()
    return this.starting
  }

  pullNow(): Promise<void> {
    return this.enqueue(() => this.pullAll())
  }

  reconcileNow(): Promise<void> {
    return this.enqueue(() => this.reconcile())
  }

  stop(): void {
    this.stopped = true
    this.watcher?.close()
    this.watcher = null
  }

  private async boot(): Promise<void> {
    try {
      await this.pullNow()
      await this.enqueue(() => this.reconcile())
      if (this.stopped) return
      this.watcher = watchUserLayer({
        targets: async () => (await Promise.all(this.args.trees.map((tree) => tree.watchTargets()))).flat(),
        onChange: () => this.handleChange(),
        debounceMs: this.args.debounceMs,
      })
      await this.watcher.refresh()
    } catch (error) {
      warnSync({ log: this.args.log, message: 'user-layer sync did not start', error })
    }
  }

  private handleChange(): void {
    if (this.applying) {
      this.missedWhileApplying = true
      return
    }
    void this.enqueue(() => this.reconcile())
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(() => (this.stopped ? undefined : task()))
    this.queue = run.catch(() => undefined)
    return run.catch((error: unknown) => {
      warnSync({ log: this.args.log, message: 'user-layer sync pass failed', error })
    })
  }

  private async contexts(): Promise<readonly TreeSyncContext[]> {
    this.state ??= await UserLayerState.load({ file: this.args.stateFile })
    const state = this.state
    return this.args.trees.map((layout) => ({
      client: this.args.client,
      state,
      layout,
      log: this.args.log,
      notice: this.args.notice,
    }))
  }

  private async pullAll(): Promise<void> {
    this.applying = true
    try {
      for (const ctx of await this.contexts()) {
        try {
          await pullTree(ctx)
        } catch (error) {
          warnSync({ log: this.args.log, message: `could not pull ${ctx.layout.tree}`, error })
        }
      }
      await this.state?.save()
    } finally {
      this.applying = false
    }
    await this.watcher?.refresh()
    if (this.missedWhileApplying) {
      this.missedWhileApplying = false
      void this.enqueue(() => this.reconcile())
    }
  }

  private async reconcile(): Promise<void> {
    for (const ctx of await this.contexts()) {
      try {
        await pushTree(ctx)
      } catch (error) {
        warnSync({ log: this.args.log, message: `could not reconcile ${ctx.layout.tree}`, error })
      }
    }
    await this.state?.save()
    await this.watcher?.refresh()
  }
}
