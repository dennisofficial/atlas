import type { KeyEvent } from '@opentui/core'
import type { ContextReader } from '@dltech/atlas-harness'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  contextTreeRows, contextTreeSelection, moveContextSelection, parentContextPath, toggleContextExpanded,
  type ContextTreeLevels,
} from '../ui/context-tree-model'
import { readContextTree, sameContextTreeLevels } from './context-tree-reader'

export function useContextTree(args: {
  readers: ContextReader | undefined
  revision: number
  opened: string | null
  onOpen: (path: string) => void
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [levels, setLevels] = useState<ContextTreeLevels>(new Map())
  const [loading, setLoading] = useState(true)
  const [focused, setFocused] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const held = useRef(levels)
  held.current = levels

  useEffect(() => {
    let live = true
    if (args.readers === undefined) { setLoading(false); return }
    if (held.current.size === 0) setLoading(true)
    void readContextTree({ readers: args.readers, expanded, previous: held.current }).then((next) => {
      if (!live) return
      setLevels((current) => sameContextTreeLevels({ left: current, right: next }) ? current : next)
      setLoading(false)
    })
    return () => { live = false }
  }, [args.readers, args.revision, expanded])

  const rows = useMemo(() => contextTreeRows({ levels, expanded }), [levels, expanded])
  const cursor = contextTreeSelection({ rows, selected })
  const toggle = useCallback((path: string) => {
    setExpanded((current) => toggleContextExpanded({ expanded: current, path }))
  }, [])
  const handleBlur = useCallback(() => setFocused(false), [])
  const handleFocus = useCallback(() => {
    setFocused(true)
    if (args.opened !== null && rows.some((row) => row.path === args.opened)) setSelected(args.opened)
  }, [args.opened, rows])
  const handleActivate = useCallback((path: string) => {
    const row = rows.find((entry) => entry.path === path)
    if (row === undefined) return
    if (focused) setSelected(path)
    if (row.isDirectory) { setFocused(true); toggle(path); return }
    if (path === args.opened) { args.onClose(); return }
    setFocused(false)
    setSelected(null)
    args.onOpen(path)
  }, [rows, focused, toggle, args.onOpen, args.onClose, args.opened])

  const handleKey = useCallback((key: Pick<KeyEvent, 'name'>) => {
    if (key.name === 'escape' || key.name === 'tab') { handleBlur(); return }
    if (key.name === 'up' || key.name === 'down') {
      setSelected(moveContextSelection({ rows, selected: cursor, delta: key.name === 'up' ? -1 : 1 }))
      return
    }
    if (key.name === 'home' || key.name === 'end') {
      setSelected((key.name === 'home' ? rows[0] : rows.at(-1))?.path ?? null)
      return
    }
    const row = rows.find((entry) => entry.path === cursor)
    if (row === undefined) return
    if (key.name === 'return' || key.name === 'enter' || key.name === 'space') { handleActivate(row.path); return }
    if (key.name === 'right' && row.isDirectory) {
      if (!row.expanded) { toggle(row.path); return }
      const index = rows.findIndex((entry) => entry.path === row.path)
      const child = rows[index + 1]
      if (child !== undefined && child.depth > row.depth) setSelected(child.path)
      return
    }
    if (key.name !== 'left') return
    if (row.isDirectory && row.expanded) { toggle(row.path); return }
    const parent = parentContextPath(row.path)
    if (parent !== '') setSelected(parent)
  }, [rows, cursor, toggle, handleBlur, handleActivate])

  return { rows, levels, expanded, cursor: focused || selected !== null ? cursor : null, opened: args.opened, focused, loading,
    handleFocus, handleBlur, handleActivate, handleKey }
}

export type ContextTreeControl = ReturnType<typeof useContextTree>
