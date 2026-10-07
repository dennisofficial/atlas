import type { ContextFolderStateStore, ContextReader } from '@dltech/atlas-harness'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { contextTreeRows, toggleContextClosed, type ContextTreeLevels } from '../ui/context-tree-model'
import { ENoticeTone, notify } from '../ui/notice-store'
import { readContextTree, sameContextTreeLevels } from './context-tree-reader'

const NOTICE_KEY_FOLDER_STATE = 'context-folder-state'
const NO_CLOSED: ReadonlySet<string> = new Set()

type Snapshot = { owner: ContextReader | undefined; levels: ContextTreeLevels }
const NO_LEVELS: ContextTreeLevels = new Map()

type Loaded = { owner: ContextFolderStateStore | undefined; closed: ReadonlySet<string>; persist: boolean }

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

const warnFolderState = ({ action, cause }: { action: string; cause: unknown }): void =>
  notify({ key: NOTICE_KEY_FOLDER_STATE, tone: ENoticeTone.Warn, text: `Could not ${action} folder state: ${messageOf(cause)}` })

export function useContextTree(args: {
  readers: ContextReader | undefined
  folderState?: ContextFolderStateStore | undefined
  revision: number
  opened: string | null
  onOpen: (path: string) => void
  onClose: () => void
}) {
  const { folderState } = args
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot>({ owner: undefined, levels: NO_LEVELS })
  const owned = snapshot.owner === args.readers && args.readers !== undefined
  const levels = owned ? snapshot.levels : NO_LEVELS
  const held = useRef(levels)
  held.current = levels
  const ready = loaded === null ? folderState === undefined : loaded.owner === folderState
  const closed = ready && loaded !== null ? loaded.closed : NO_CLOSED
  const persist = ready && loaded?.persist !== false
  const latestClosed = useRef(closed)
  latestClosed.current = closed

  useEffect(() => {
    if (folderState === undefined) { setLoaded(null); return }
    let live = true
    folderState.load().then((paths) => {
      if (live) setLoaded({ owner: folderState, closed: new Set(paths), persist: true })
    }, (cause: unknown) => {
      if (!live) return
      warnFolderState({ action: 'load', cause })
      setLoaded({ owner: folderState, closed: NO_CLOSED, persist: false })
    })
    return () => { live = false }
  }, [folderState])

  useEffect(() => {
    let live = true
    const { readers } = args
    if (readers === undefined || !ready) return
    void readContextTree({ readers, closed, previous: held.current }).then((next) => {
      if (!live) return
      setSnapshot((current) => current.owner === readers && sameContextTreeLevels({ left: current.levels, right: next })
        ? current : { owner: readers, levels: next })
    })
    return () => { live = false }
  }, [args.readers, args.revision, closed, ready])

  const rows = useMemo(() => contextTreeRows({ levels, closed }), [levels, closed])
  const handleToggle = useCallback((path: string) => {
    const next = toggleContextClosed({ closed: latestClosed.current, path })
    latestClosed.current = next
    setLoaded({ owner: folderState, closed: next, persist })
    if (folderState === undefined || !persist) return
    folderState.save([...next]).catch((cause: unknown) => warnFolderState({ action: 'save', cause }))
  }, [folderState, persist])
  const handleActivate = useCallback((path: string) => {
    const row = rows.find((entry) => entry.path === path)
    if (row === undefined || !ready || !owned) return
    if (row.isDirectory) { handleToggle(path); return }
    if (path === args.opened) { args.onClose(); return }
    args.onOpen(path)
  }, [rows, ready, owned, handleToggle, args.onOpen, args.onClose, args.opened])

  return { rows, levels, closed, opened: args.opened, loading: args.readers !== undefined && (!owned || !ready), handleActivate }
}

export type ContextTreeControl = ReturnType<typeof useContextTree>
