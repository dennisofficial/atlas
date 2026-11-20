import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import type { McpConfigPort } from './config'
import { McpStore } from './store'

const CONNECT_TIMEOUT_MS = 30_000

const RECONCILE_BUDGET_MS = 5_000

export class McpStores {
  private readonly stores = new WeakMap<PluginPodContext, McpStore>()
  private readonly bySession = new Map<string, McpStore>()

  constructor(
    private readonly args: {
      config: McpConfigPort
      connectTimeoutMs?: number
      reconcileBudgetMs?: number
    },
  ) {}

  forSession(sessionId: string): McpStore | undefined {
    return this.bySession.get(sessionId)
  }

  of(ctx: PluginPodContext): McpStore {
    const kept = this.stores.get(ctx)
    if (kept !== undefined) return kept
    const store = new McpStore({
      ctx,
      config: this.args.config,
      connectTimeoutMs: this.args.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
      reconcileBudgetMs: this.args.reconcileBudgetMs ?? RECONCILE_BUDGET_MS,
    })
    this.stores.set(ctx, store)
    this.bySession.set(ctx.sessionId, store)
    return store
  }
}
