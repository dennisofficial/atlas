import type { SessionApi } from './session-api'

export const COMPOSER_DRAFT_DEBOUNCE_MS = 500

export type DraftSchedule = (run: () => void, ms: number) => () => void

export type ComposerDraft = {
  load: () => Promise<string | null>
  handleText: (text: string) => void
  dispose: () => void
}

const timeoutSchedule: DraftSchedule = (run, ms) => {
  const timer = setTimeout(run, ms)
  timer.unref?.()
  return () => clearTimeout(timer)
}

export const composerDraftOf = (args: {
  api: Pick<SessionApi, 'loadDraft' | 'saveDraft' | 'clearDraft'>
  scope: string
  debounceMs?: number | undefined
  schedule?: DraftSchedule | undefined
}): ComposerDraft => {
  const debounceMs = args.debounceMs ?? COMPOSER_DRAFT_DEBOUNCE_MS
  const schedule = args.schedule ?? timeoutSchedule

  let synced = ''
  let touched = false
  let pending: string | null = null
  let cancel: (() => void) | null = null
  let tail: Promise<void> = Promise.resolve()

  const enqueue = (run: () => Promise<void>): void => {
    tail = tail.then(run).catch(() => undefined)
  }

  const cancelPending = (): void => {
    cancel?.()
    cancel = null
    pending = null
  }

  const flush = (): void => {
    const text = pending
    cancel = null
    pending = null
    if (text === null) return
    synced = text
    enqueue(() => args.api.saveDraft({ scope: args.scope, text }))
  }

  return {
    load: async () => {
      const text = await args.api.loadDraft(args.scope).catch(() => null)
      if (touched || text === null || text.trim().length === 0) return null
      synced = text
      return text
    },

    handleText: (text) => {
      const wanted = text.trim().length === 0 ? '' : text
      if (wanted === synced) {
        cancelPending()
        return
      }

      touched = true

      if (wanted === '') {
        cancelPending()
        synced = ''
        enqueue(() => args.api.clearDraft(args.scope))
        return
      }

      cancelPending()
      pending = wanted
      cancel = schedule(flush, debounceMs)
    },

    dispose: () => {
      cancel?.()
      flush()
    },
  }
}
