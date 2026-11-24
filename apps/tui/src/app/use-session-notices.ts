import { useCallback, useRef } from 'react'

import type { StreamSessionRow } from '@dltech/atlas-protocol'

import { finishedNoticesOf, type SessionNotice } from './session-notices'

export function useSessionNotices(args: {
  watching: string | null
  onNotice: (notice: SessionNotice) => void
}): (rows: readonly StreamSessionRow[]) => void {
  const previous = useRef<readonly StreamSessionRow[] | null>(null)
  const onNotice = useRef(args.onNotice)
  onNotice.current = args.onNotice
  const watching = useRef(args.watching)
  watching.current = args.watching

  return useCallback((rows: readonly StreamSessionRow[]) => {
    const before = previous.current
    previous.current = rows
    if (before === null) return

    const notices = finishedNoticesOf({ previous: before, next: rows, watching: watching.current })
    for (const notice of notices) onNotice.current(notice)
  }, [])
}
