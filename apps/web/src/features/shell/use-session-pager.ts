'use client'

import { useEffect, useMemo, useState } from 'react'

import { fetchSessionPage } from '@/features/sessions/data/sessions-api'

import {
  createSessionPager,
  EMPTY_SESSION_PAGE,
  type PageBucket,
  type SessionPageSnapshot,
} from './session-pager'

export const SEARCH_DEBOUNCE_MS = 250

export interface SessionPagerView {
  snapshot: SessionPageSnapshot
  term: string
  setTerm: (term: string) => void
  loadMore: () => void
}

export function useSessionPager(bucket: PageBucket): SessionPagerView {
  const [snapshot, setSnapshot] = useState<SessionPageSnapshot>(EMPTY_SESSION_PAGE)
  const [term, setTerm] = useState('')
  const pager = useMemo(
    () => createSessionPager({ bucket, load: fetchSessionPage, emit: setSnapshot }),
    [bucket],
  )

  useEffect(() => {
    pager.start()
  }, [pager])

  useEffect(() => {
    const timer = setTimeout(() => pager.search(term), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [pager, term])

  return { snapshot, term, setTerm, loadMore: pager.more }
}
