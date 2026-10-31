import type { ThreadId } from '@dltech/atlas-core'
import type { Unsubscribe } from '@dltech/atlas-harness'
import { pendingTldrOf, subscribeTldrFeed, type PendingTldr } from '../ui/tldr-feed-store'

export function watchPendingTldr(args: {
  threadId: ThreadId
  current: () => PendingTldr | null
  onChange: (next: PendingTldr | null) => void
}): Unsubscribe {
  return subscribeTldrFeed(() => {
    const previous = args.current()
    const next = pendingTldrOf(args.threadId) ?? null
    if (next === null && previous === null) return
    if (
      next !== null &&
      previous !== null &&
      next.anchorSeq === previous.anchorSeq &&
      next.text === previous.text
    ) {
      return
    }
    args.onChange(next)
  })
}
