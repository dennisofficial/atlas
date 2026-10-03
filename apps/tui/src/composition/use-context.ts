import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core'
import type { DirectoryEntry } from '@dltech/atlas-core'
import type { ContextFileContent } from '@dltech/atlas-harness'
import { useCallback, useEffect, useRef, useState } from 'react'

import { EOutputScroll, outputScrollCommand } from '../ui/shells-model'
import type { ContextReaders } from './session-binding'

export enum EContextView { Loading = 'loading', Ready = 'ready' }
export type ContextViewer =
  | { state: EContextView.Loading; path: string }
  | { state: EContextView.Ready; path: string; content: ContextFileContent }

const sameEntries = (left: readonly DirectoryEntry[], right: readonly DirectoryEntry[]): boolean =>
  left.length === right.length &&
  left.every((entry, index) => entry.name === right[index]?.name && entry.isDirectory === right[index]?.isDirectory)

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

export function useContextBrowser(args: { readers: ContextReaders | undefined }) {
  const { readers } = args
  const [entries, setEntries] = useState<readonly DirectoryEntry[]>([])
  const [directory, setDirectory] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [viewer, setViewer] = useState<ContextViewer | null>(null)
  const [revision, setRevision] = useState(0)
  const scroller = useRef<ScrollBoxRenderable | null>(null)

  useEffect(() => {
    if (readers === undefined) return
    return readers.subscribe(() => setRevision((value) => value + 1))
  }, [readers])

  useEffect(() => {
    let live = true
    if (readers === undefined) { setLoading(false); return }
    setLoading(true)
    void readers.list(directory || undefined).then((next) => {
      if (!live) return
      setEntries((current) => sameEntries(current, next) ? current : next)
      setError(null)
      setLoading(false)
    }, (cause: unknown) => {
      if (!live) return
      setError(messageOf(cause))
      setLoading(false)
    })
    return () => { live = false }
  }, [readers, directory, revision])

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

  const handleOpen = useCallback((name: string) => {
    const next = directory ? `${directory}/${name}` : name
    if (entries.find((entry) => entry.name === name)?.isDirectory === true) {
      setDirectory(next)
      return
    }
    setPath(next)
    setViewer({ state: EContextView.Loading, path: next })
  }, [directory, entries])

  const handleUp = useCallback(() => setDirectory((current) => current.split('/').slice(0, -1).join('/')), [])
  const handleDismiss = useCallback(() => { setPath(null); setViewer(null) }, [])
  const attachScroll = useCallback((box: ScrollBoxRenderable | null) => { scroller.current = box }, [])

  const handleKey = useCallback((key: Pick<KeyEvent, 'name'> & Partial<Pick<KeyEvent, 'shift'>>) => {
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
  }, [handleDismiss])

  return { entries, directory, error, loading, viewer, handleOpen, handleUp, handleDismiss, handleKey, attachScroll }
}

export type ContextControl = ReturnType<typeof useContextBrowser>
