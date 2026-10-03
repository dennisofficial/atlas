import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core'
import type { ContextFileContent } from '@dltech/atlas-harness'
import { useCallback, useEffect, useRef, useState } from 'react'

import { EOutputScroll, outputScrollCommand } from '../ui/shells-model'
import type { ContextReaders } from './session-binding'
import { useContextTree } from './use-context-tree'

export enum EContextView { Loading = 'loading', Ready = 'ready' }
export type ContextViewer =
  | { state: EContextView.Loading; path: string }
  | { state: EContextView.Ready; path: string; content: ContextFileContent }

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

export function useContextBrowser(args: {
  readers: ContextReaders | undefined
  onOpenFile?: () => void
}) {
  const { readers } = args
  const [path, setPath] = useState<string | null>(null)
  const [viewer, setViewer] = useState<ContextViewer | null>(null)
  const [revision, setRevision] = useState(0)
  const scroller = useRef<ScrollBoxRenderable | null>(null)

  useEffect(() => {
    if (readers === undefined) return
    return readers.subscribe(() => setRevision((value) => value + 1))
  }, [readers])

  useEffect(() => {
    if (path === null || readers === undefined) { setViewer(null); return }
    let live = true
    setViewer((current) => current?.path === path ? current : { state: EContextView.Loading, path })
    void readers.load(path).catch((cause: unknown): ContextFileContent => ({ type: 'refused', reason: messageOf(cause) }))
      .then((content) => {
        if (!live) return
        setViewer((current) => current?.state === EContextView.Ready && current.path === path &&
          JSON.stringify(current.content) === JSON.stringify(content) ? current : { state: EContextView.Ready, path, content })
      })
    return () => { live = false }
  }, [readers, path, revision])

  const handleFileOpen = useCallback((next: string) => {
    if (path === next) setRevision((value) => value + 1)
    else {
      setPath(next)
      setViewer({ state: EContextView.Loading, path: next })
    }
    args.onOpenFile?.()
  }, [args.onOpenFile, path])
  const tree = useContextTree({ readers, revision, opened: path, onOpen: handleFileOpen })
  const handleDismiss = useCallback(() => {
    setPath(null)
    setViewer(null)
    tree.handleBlur()
  }, [tree.handleBlur])
  const attachScroll = useCallback((box: ScrollBoxRenderable | null) => { scroller.current = box }, [])

  const handleKey = useCallback((key: Pick<KeyEvent, 'name'> & Partial<Pick<KeyEvent, 'shift'>>) => {
    if (tree.focused) { tree.handleKey(key); return }
    if (key.name === 'tab') { tree.handleFocus(); return }
    if (key.name === 'escape' || key.name === 'q') { handleDismiss(); return }
    const command = key.name === 'up' || key.name === 'down'
      ? { kind: EOutputScroll.Lines, amount: key.name === 'up' ? -3 : 3 }
      : outputScrollCommand(key)
    const box = scroller.current
    if (!box || command === null) return
    if (command.kind === EOutputScroll.ToEnd) box.scrollTo(Math.max(0, box.scrollHeight - box.viewport.height))
    else if (command.kind === EOutputScroll.ToStart) box.scrollTo(0)
    else if (command.kind === EOutputScroll.Pages) box.scrollBy(command.amount, 'viewport')
    else box.scrollBy(command.amount)
  }, [tree.focused, tree.handleKey, tree.handleFocus, handleDismiss])

  return { tree, viewer, handleOpen: tree.handleActivate, handleDismiss, handleKey, attachScroll,
    handleViewerFocus: tree.handleBlur }
}

export type ContextControl = ReturnType<typeof useContextBrowser>
