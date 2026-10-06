import type { ContextFolderStateStore, ContextReader } from '@dltech/atlas-harness'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { contextTreeRows, toggleContextClosed, type ContextTreeLevels } from '../ui/context-tree-model'
import { ENoticeTone, notify } from '../ui/notice-store'
import { readContextTree, sameContextTreeLevels } from './context-tree-reader'

const NOTICE_KEY_FOLDER_STATE = 'context-folder-state'
const NO_CLOSED: ReadonlySet<string> = new Set()

type Loaded = { owner: ContextFolderStateStore | undefined; closed: ReadonlySet<string> }

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
  const [levels, setLevels] = useState<ContextTreeLevels>(new Map())
  const [loading, setLoading] = useState(true)
  const held = useRef(levels)
  held.current = levels
  const ready = loaded === null ? folderState === undefined : loaded.owner === folderState
  const closed = ready && loaded !== null ? loaded.closed : NO_CLOSED
  const latestClosed = useRef(closed)
  latestClosed.current = closed

  useEffect(() => {
    if (folderState === undefined) { setLoaded(null); return }
    let live = true
    folderState.load().then((paths) => {
      if (live) setLoaded({ owner: folderState, closed: new Set(paths) })
    }, (cause: unknown) => {
      if (!live) return
      warnFolderState({ action: 'load', cause })
      setLoaded({ owner: folderState, closed: NO_CLOSED })
    })
    return () => { live = false }
  }, [folderState])

  useEffect(() => {
    let live = true
    if (args.readers === undefined) { setLoading(false); return }
    if (!ready) return
    if (held.current.size === 0) setLoading(true)
    void readContextTree({ readers: args.readers, closed, previous: held.current }).then((next) => {
      if (!live) return
      setLevels((current) => sameContextTreeLevels({ left: current, right: next }) ? current : next)
      setLoading(false)
    })
    return () => { live = false }
  }, [args.readers, args.revision, closed, ready])

  const rows = useMemo(() => contextTreeRows({ levels, closed }), [levels, closed])
  const handleToggle = useCallback((path: string) => {
    const next = toggleContextClosed({ closed: latestClosed.current, path })
    latestClosed.current = next
    setLoaded({ owner: folderState, closed: next })
    if (folderState === undefined) return
    folderState.save([...next]).catch((cause: unknown) => warnFolderState({ action: 'save', cause }))
  }, [folderState])
  const handleActivate = useCallback((path: string) => {
    const row = rows.find((entry) => entry.path === path)
    if (row === undefined) return
    if (row.isDirectory) { if (ready) handleToggle(path); return }
    if (path === args.opened) { args.onClose(); return }
    args.onOpen(path)
  }, [rows, ready, handleToggle, args.onOpen, args.onClose, args.opened])

  return { rows, levels, closed, opened: args.opened, loading: loading || !ready, handleActivate }
}

export type ContextTreeControl = ReturnType<typeof useContextTree>
