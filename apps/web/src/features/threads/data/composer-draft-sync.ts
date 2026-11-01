import type { SaidUpload } from '@dltech/atlas-core'

export const DRAFT_DEBOUNCE_MS = 500

export type DraftContent = { text: string; uploads: readonly SaidUpload[] }

export type DraftSchedule = (run: () => void, delayMs: number) => () => void

const EMPTY: DraftContent = { text: '', uploads: [] }

const isEmpty = (content: DraftContent): boolean =>
  content.text === '' && content.uploads.length === 0

const keyOf = (content: DraftContent): string =>
  `${content.text}\u0000${content.uploads.map((upload) => upload.uploadId).join(',')}`

const defaultSchedule: DraftSchedule = (run, delayMs) => {
  const timer = setTimeout(run, delayMs)
  return () => clearTimeout(timer)
}

export type DraftSync = ReturnType<typeof createDraftSync>

export function createDraftSync(args: {
  scope: string
  put: (args: { scope: string; text: string; uploads: readonly SaidUpload[] }) => Promise<unknown>
  clear: (scope: string) => Promise<unknown>
  delayMs?: number
  schedule?: DraftSchedule
}) {
  const delayMs = args.delayMs ?? DRAFT_DEBOUNCE_MS
  const schedule = args.schedule ?? defaultSchedule
  let loading = true
  let disposed = false
  let latest = EMPTY
  let latestKey = keyOf(EMPTY)
  let cancelTimer: (() => void) | null = null
  let sentText: string | null = null
  let tail: Promise<unknown> = Promise.resolve()

  const enqueue = (operation: () => Promise<unknown>) => {
    tail = tail.then(operation).catch(() => undefined)
  }

  const write = (content: DraftContent) =>
    enqueue(() =>
      isEmpty(content)
        ? args.clear(args.scope)
        : args.put({ scope: args.scope, text: content.text, uploads: content.uploads }),
    )

  const stopTimer = () => {
    cancelTimer?.()
    cancelTimer = null
  }

  const react = (content: DraftContent) => {
    if (isEmpty(content)) sentText = null
    if (sentText !== null && content.text.trim() === sentText && content.uploads.length === 0) {
      return
    }
    sentText = null
    const key = keyOf(content)
    if (key === latestKey) return
    latestKey = key
    stopTimer()
    cancelTimer = schedule(() => {
      cancelTimer = null
      write(latest)
    }, delayMs)
  }

  return {
    change(content: DraftContent): void {
      if (disposed) return
      latest = content
      if (!loading) react(content)
    },

    loaded(stored: DraftContent | null): DraftContent | null {
      if (disposed) return null
      loading = false
      if (stored !== null && !isEmpty(stored) && isEmpty(latest)) {
        latest = stored
        latestKey = keyOf(stored)
        return stored
      }
      react(latest)
      return null
    },

    handleSent(text: string): void {
      if (disposed) return
      stopTimer()
      sentText = text.trim()
      latestKey = keyOf(EMPTY)
      write(EMPTY)
    },

    flush(): void {
      if (cancelTimer === null) return
      stopTimer()
      write(latest)
    },

    dispose(): void {
      stopTimer()
      disposed = true
    },
  }
}
