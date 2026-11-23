import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createSessionsFeed, type FollowedSessionList } from '@dltech/atlas-client/stream'
import type { SessionModelChoice, StreamSessionRow } from '@dltech/atlas-protocol'

import {
  loadingThreads,
  matchingThreads,
  moveSelection,
  selectedThread,
  withThreads,
  type ThreadRow,
  type ThreadsState,
} from '../ui/threads-model'
import { EOpenMode, resumeTargetOf, type OpenRequest } from './launch-flags'
import { sessionRowsOf } from './session-rows'

export type SessionListControl = {
  state: ThreadsState
  handlePick: (row: ThreadRow) => void
  handleQuery: (query: string) => void
  handleKey: (key: KeyEvent) => void
  modelOf: (sessionId: string) => SessionModelChoice | null
}

export function useSessionList(args: {
  follow: () => FollowedSessionList
  onPick: (row: ThreadRow) => void
  now: () => number
  pendingOpen?: OpenRequest | null
  onRows?: (rows: readonly StreamSessionRow[]) => void
  onProblem?: (reason: string) => void
}): SessionListControl {
  const { follow, onPick, now } = args
  const held = useRef<ThreadsState>(loadingThreads({ now: now() }))
  const [state, setState] = useState<ThreadsState>(held.current)
  const models = useRef<ReadonlyMap<string, SessionModelChoice>>(new Map())
  const resumed = useRef(false)
  const argsRef = useRef(args)
  argsRef.current = args

  const put = useCallback((next: ThreadsState) => {
    held.current = next
    setState(next)
  }, [])

  const resumeTo = useCallback(
    (args: { rows: readonly StreamSessionRow[]; next: readonly ThreadRow[] }) => {
      const { pendingOpen, onProblem } = argsRef.current
      if (pendingOpen === null || pendingOpen === undefined || resumed.current) return
      if (pendingOpen.mode === EOpenMode.New) return
      if (args.rows.length === 0) return
      resumed.current = true

      const target = resumeTargetOf({ rows: args.rows, open: pendingOpen })
      if (target === null) {
        const named =
          pendingOpen.mode === EOpenMode.Resume
            ? `no session matched --resume ${pendingOpen.handle}`
            : 'no session to continue'
        onProblem?.(named)
        return
      }

      const row = args.next.find((entry) => entry.threadId === target.sessionId)
      if (row !== undefined) onPick(row)
    },
    [onPick],
  )

  const putRows = useCallback(
    (rows: readonly StreamSessionRow[]) => {
      const current = held.current
      const selected = matchingThreads(current)[current.index]?.threadId
      const next = sessionRowsOf({ rows, now: now(), activeSessionId: null })
      const selectedIndex =
        selected === undefined ? -1 : next.findIndex((row) => row.threadId === selected)
      const rebuilt = withThreads({ state: current, rows: next })
      put(selectedIndex >= 0 ? { ...rebuilt, index: selectedIndex } : rebuilt)

      models.current = new Map(rows.map((row) => [row.sessionId, row.model]))
      argsRef.current.onRows?.(rows)
      resumeTo({ rows, next })
    },
    [now, put, resumeTo],
  )

  const write = useRef(putRows)
  write.current = putRows

  const feed = useMemo(
    () => createSessionsFeed({ follow, write: (rows) => write.current(rows) }),
    [follow],
  )

  useEffect(() => feed.retain(), [feed])

  const handlePick = useCallback((row: ThreadRow) => onPick(row), [onPick])

  const handleQuery = useCallback(
    (query: string) => put({ ...held.current, query, index: 0, failure: null }),
    [put],
  )

  const handleKey = useCallback(
    (key: KeyEvent) => {
      const current = held.current

      if (key.name === 'up' || key.name === 'down') {
        put(moveSelection({ state: current, delta: key.name === 'up' ? -1 : 1 }))
        return
      }

      if (key.name === 'return') {
        const row = selectedThread(current)
        if (row !== undefined) onPick(row)
      }
    },
    [onPick, put],
  )

  const modelOf = useCallback(
    (sessionId: string): SessionModelChoice | null => models.current.get(sessionId) ?? null,
    [],
  )

  return { state, handlePick, handleQuery, handleKey, modelOf }
}
