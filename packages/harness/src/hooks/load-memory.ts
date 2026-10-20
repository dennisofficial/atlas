import {
  BeforeTurnHook,
  EStage,
  renderMemoryIndex,
  type BeforeTurn,
  type HookOrder,
} from '@dltech/atlas-core'
import { EMemoryScope, type MemorySummary } from '@dltech/atlas-wire'

import type { MemoryIndexState } from '../memory/memory-index-state'
import { MemoryUnavailable, type MemoryPort } from '../memory/memory-port'

import { HOOK_BUDGET_MS } from './budget'

export const MEMORY_LIST_DEADLINE_MS = Math.floor(HOOK_BUDGET_MS * 0.6)

const unavailableText = (reason: string): string => `Memory is unavailable this session: ${reason}.`

const reasonOf = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\.+$/, '')
}

const indexLinesOf = (summaries: readonly MemorySummary[]) =>
  summaries.map((summary) => ({ name: summary.name, description: summary.description }))

const listWithin = (args: {
  port: MemoryPort
  deadlineMs: number
}): Promise<readonly MemorySummary[]> =>
  new Promise((resolve, reject) => {
    const expiry = setTimeout(
      () => reject(new MemoryUnavailable(`the memory index did not load within ${args.deadlineMs}ms`)),
      args.deadlineMs,
    )
    args.port
      .list({ timeoutMs: args.deadlineMs })
      .then(resolve, reject)
      .finally(() => clearTimeout(expiry))
  })

export class LoadMemoryIndexHook extends BeforeTurnHook {
  readonly name = 'memory-index'
  readonly order: HookOrder = { stage: EStage.Observe, nudge: 0 }

  private readonly port: MemoryPort
  private readonly state: MemoryIndexState
  private readonly deadlineMs: number

  constructor(args: { port: MemoryPort; state: MemoryIndexState; deadlineMs?: number | undefined }) {
    super()
    this.port = args.port
    this.state = args.state
    this.deadlineMs = args.deadlineMs ?? MEMORY_LIST_DEADLINE_MS
  }

  readonly run: BeforeTurn = async () => {
    if (this.state.text !== null && !this.state.lastFailed) return {}

    this.state.loading ??= this.load().finally(() => {
      this.state.loading = null
    })
    await this.state.loading
    return {}
  }

  private async load(): Promise<void> {
    try {
      const summaries = await listWithin({ port: this.port, deadlineMs: this.deadlineMs })
      const project = this.port.project
      this.state.text = renderMemoryIndex({
        global: indexLinesOf(summaries.filter((summary) => summary.scope === EMemoryScope.Global)),
        project:
          project === null
            ? null
            : {
                key: project,
                entries: indexLinesOf(
                  summaries.filter((summary) => summary.scope === EMemoryScope.Project),
                ),
              },
      })
      this.state.lastFailed = false
    } catch (error) {
      this.state.text = unavailableText(reasonOf(error))
      this.state.lastFailed = true
    }
  }
}
