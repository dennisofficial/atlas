import { useEffect, useRef } from 'react'

import type { StreamSessionRow } from '@dltech/atlas-protocol'

import { finishedNoticesOf, type SessionNotice } from './session-notices'

export function useSessionNotices(args: {
  rows: readonly StreamSessionRow[] | undefined
  watching: string | null
  onNotice: (notice: SessionNotice) => void
}): void {
  const previous = useRef<readonly StreamSessionRow[] | null>(null)
  const onNotice = useRef(args.onNotice)
  onNotice.current = args.onNotice
  const { rows, watching } = args

  useEffect(() => {
    if (rows === undefined) return

    const before = previous.current
    previous.current = rows
    if (before === null) return

    for (const notice of finishedNoticesOf({ previous: before, next: rows, watching })) {
      onNotice.current(notice)
    }
  }, [rows, watching])
}
