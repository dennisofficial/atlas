import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core'
import type { ContextFileContent, ContextFolderStateStore } from '@dltech/atlas-harness'
import { useCallback, useEffect, useRef, useState } from 'react'

import { EOutputScroll, outputScrollCommand } from '../ui/shells-model'
import type { ContextReaders } from './session-binding'
import { useContextTree } from './use-context-tree'

export enum EContextView { Loading = 'loading', Ready = 'ready' }
export type ContextViewer =
  | { state: EContextView.Loading; path: string }
  | { state: EContextView.Ready; path: string; content: ContextFileContent }

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

const PAN_COLUMNS = 8

export function useContextBrowser(args: {
  readers: ContextReaders | undefined
  folderState?: ContextFolderStateStore | undefined
  onOpenFile?: () => void
}) {
  const { readers, folderState } = args
  const [opened, setOpened] = useState<{ owner: ContextReaders | undefined; path: string } | null>(null)
  const [viewerHeld, setViewerHeld] = useState<{ owner: ContextReaders | undefined; viewer: ContextViewer | null }>(
    { owner: readers, viewer: null })
  const path = opened !== null && opened.owner === readers ? opened.path : null
  const viewer = viewerHeld.owner === readers ? viewerHeld.viewer : null
  const updateViewer = useCallback((update: (current: ContextViewer | null) => ContextViewer | null) => {
    setViewerHeld((held) => ({ owner: readers, viewer: update(held.owner === readers ? held.viewer : null) }))
  }, [readers])
  const [revision, setRevision] = useState(0)
  const scroller = useRef<ScrollBoxRenderable | null>(null)

  useEffect(() => {
    if (readers === undefined) return
    return readers.subscribe(() => setRevision((value) => value + 1))
  }, [readers])

  useEffect(() => {
    if (path === null || readers === undefined) { updateViewer(() => null); return }
    let live = true
    updateViewer((current) => current?.path === path ? current : { state: EContextView.Loading, path })
    void readers.load(path).catch((cause: unknown): ContextFileContent => ({ type: 'refused', reason: messageOf(cause) }))
      .then((content) => {
        if (!live) return
        updateViewer((current) => current?.state === EContextView.Ready && current.path === path &&
          JSON.stringify(current.content) === JSON.stringify(content) ? current : { state: EContextView.Ready, path, content })
      })
    return () => { live = false }
  }, [readers, path, revision, updateViewer])

  useEffect(() => {
    setOpened((current) => current?.owner === readers ? current : null)
  }, [readers])

  const handleFileOpen = useCallback((next: string) => {
    setOpened({ owner: readers, path: next })
    updateViewer((current) => current?.path === next ? current : { state: EContextView.Loading, path: next })
    args.onOpenFile?.()
  }, [readers, updateViewer, args.onOpenFile])
  const handleFileClose = useCallback(() => {
    setOpened(null)
    updateViewer(() => null)
  }, [updateViewer])
  const tree = useContextTree({ readers, folderState, revision, opened: path, onOpen: handleFileOpen, onClose: handleFileClose })
  const attachScroll = useCallback((box: ScrollBoxRenderable | null) => { scroller.current = box }, [])

  const handleKey = useCallback((key: Pick<KeyEvent, 'name'> & Partial<Pick<KeyEvent, 'shift'>>) => {
    if (key.name === 'escape' || key.name === 'q') { handleFileClose(); return }
    if (key.name === 'left' || key.name === 'right') {
      scroller.current?.scrollBy({ x: key.name === 'left' ? -PAN_COLUMNS : PAN_COLUMNS, y: 0 })
      return
    }
    const command = key.name === 'up' || key.name === 'down'
      ? { kind: EOutputScroll.Lines, amount: key.name === 'up' ? -3 : 3 }
      : outputScrollCommand(key)
    const box = scroller.current
    if (!box || command === null) return
    if (command.kind === EOutputScroll.ToEnd) box.scrollTo(Math.max(0, box.scrollHeight - box.viewport.height))
    else if (command.kind === EOutputScroll.ToStart) box.scrollTo(0)
    else if (command.kind === EOutputScroll.Pages) box.scrollBy(command.amount, 'viewport')
    else box.scrollBy(command.amount)
  }, [handleFileClose])

  return { tree, viewer, handleOpen: tree.handleActivate, handleNavigate: handleFileOpen, handleDismiss: handleFileClose,
    handleKey, attachScroll }
}

export type ContextControl = ReturnType<typeof useContextBrowser>
