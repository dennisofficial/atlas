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
import { EOpenMode, EMissedEnd, resolveOpen, type OpenRequest } from './launch-flags'
import { sessionRowsOf } from './session-rows'

const missedNoticeOf = (args: { open: OpenRequest; missed: EMissedEnd }): string => {
  if (args.missed === EMissedEnd.ResumeUnknown && args.open.mode === EOpenMode.Resume)
    return `no session matched --resume ${args.open.handle}`
  if (args.missed === EMissedEnd.LastArchived)
    return 'continued to the newest session: the one you last had open is archived'
  return 'continued to the newest session: the one you last had open is no longer listed'
}

export type SessionListControl = {
  state: ThreadsState
  rows: readonly StreamSessionRow[]
  rowOf: (sessionId: string) => StreamSessionRow | undefined
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
  lastSessionId?: string | null
  onRows?: (rows: readonly StreamSessionRow[]) => void
  onProblem?: (reason: string) => void
}): SessionListControl {
  const { follow, onPick, now } = args
  const held = useRef<ThreadsState>(loadingThreads({ now: now() }))
  const [state, setState] = useState<ThreadsState>(held.current)
  const models = useRef<ReadonlyMap<string, SessionModelChoice>>(new Map())
  const [rows, setRows] = useState<readonly StreamSessionRow[]>([])
  const heldRows = useRef<readonly StreamSessionRow[]>([])
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

      const resolved = resolveOpen({
        rows: args.rows,
        open: pendingOpen,
        lastSessionId: argsRef.current.lastSessionId ?? null,
      })
      if (resolved.missed !== null)
        onProblem?.(missedNoticeOf({ open: pendingOpen, missed: resolved.missed }))

      if (resolved.row === null) {
        if (resolved.missed === null) onProblem?.('no session to continue')
        return
      }

      const row = args.next.find((entry) => entry.threadId === resolved.row?.sessionId)
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
      heldRows.current = rows
      setRows(rows)
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

  const rowOf = useCallback(
    (sessionId: string): StreamSessionRow | undefined =>
      heldRows.current.find((row) => row.sessionId === sessionId),
    [],
  )

  return { state, rows, rowOf, handlePick, handleQuery, handleKey, modelOf }
}
