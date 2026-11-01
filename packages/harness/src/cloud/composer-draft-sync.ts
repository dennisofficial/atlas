import type { ThreadId } from '@dltech/atlas-core'
import { COMPOSER_DRAFT_NEW_THREAD_SCOPE } from '@dltech/atlas-wire'

import type { ComposerDraftApi } from './composer-draft-api'

export const COMPOSER_DRAFT_DEBOUNCE_MS = 500

export type ComposerDraftScheduler = {
  schedule: (run: () => void, ms: number) => () => void
}

const timeoutScheduler: ComposerDraftScheduler = {
  schedule: (run, ms) => {
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  },
}

export const composerDraftScope = (args: {
  threadId: ThreadId
  cloudThread: boolean
  unborn: boolean
}): string | null => {
  if (args.cloudThread) return args.threadId
  return args.unborn ? COMPOSER_DRAFT_NEW_THREAD_SCOPE : null
}

export class ComposerDraftSync {
  private synced = ''
  private touched = false
  private pending: string | null = null
  private cancelTimer: (() => void) | null = null
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly args: {
      api: ComposerDraftApi
      scope: string
      debounceMs?: number | undefined
      scheduler?: ComposerDraftScheduler | undefined
    },
  ) {}

  async load(): Promise<string | null> {
    const text = await this.args.api.load({ scope: this.args.scope }).catch(() => null)
    if (this.touched || text === null || text.trim().length === 0) return null
    this.synced = text
    return text
  }

  handleText(text: string): void {
    const wanted = text.trim().length === 0 ? '' : text
    if (wanted === this.synced) {
      this.cancelPending()
      return
    }
    this.touched = true
    if (wanted === '') {
      this.cancelPending()
      this.synced = ''
      this.enqueue(() => this.args.api.discard({ scope: this.args.scope }))
      return
    }
    this.cancelTimer?.()
    this.pending = wanted
    this.cancelTimer = (this.args.scheduler ?? timeoutScheduler).schedule(
      () => this.flush(),
      this.args.debounceMs ?? COMPOSER_DRAFT_DEBOUNCE_MS,
    )
  }

  dispose(): void {
    this.cancelTimer?.()
    this.flush()
  }

  private flush(): void {
    const text = this.pending
    this.cancelTimer = null
    this.pending = null
    if (text === null) return
    this.synced = text
    this.enqueue(() => this.args.api.save({ scope: this.args.scope, text }))
  }

  private cancelPending(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
    this.pending = null
  }

  private enqueue(run: () => Promise<void>): void {
    this.tail = this.tail.then(run).catch(() => undefined)
  }
}

export const composerDraftSyncFor = (args: {
  cloud: { composerDraftApi: () => ComposerDraftApi | null }
  scope: string | null
}): ComposerDraftSync | null => {
  if (args.scope === null) return null
  const api = args.cloud.composerDraftApi()
  return api === null ? null : new ComposerDraftSync({ api, scope: args.scope })
}
