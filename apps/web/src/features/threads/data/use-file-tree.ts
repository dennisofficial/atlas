'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { recallThreadPanel, rememberThreadPanel } from '../panel/thread-panel-memory'
import { messageOfFailure } from './git-changes-load'
import { ROOT_DIRECTORY } from './file-tree-source'
import type { DirectoryListings } from './file-tree-nodes'
import type { TreeEntry } from './file-tree-source'
import type { FileSource } from './file-source'

export enum EFileTreeStatus {
  Loading = 'loading',
  Ready = 'ready',
  Failed = 'failed',
}

export type FileTreeView =
  | { status: EFileTreeStatus.Loading }
  | { status: EFileTreeStatus.Ready; listings: DirectoryListings }
  | { status: EFileTreeStatus.Failed; message: string }

export type FileTreeState = {
  view: FileTreeView
  open: string[]
  setOpen: (args: { directory: string; open: boolean }) => void
}

const LOADING: FileTreeView = { status: EFileTreeStatus.Loading }

async function listOrEmpty(args: { source: FileSource; directory: string }): Promise<TreeEntry[]> {
  return args.source.browse({ directory: args.directory }).catch((error: unknown) => {
    if (args.directory === ROOT_DIRECTORY) throw error
    return []
  })
}

export function useFileTree(args: {
  source: FileSource | null
  refreshKey?: number
  podAwake?: boolean
  threadId: string
}): FileTreeState {
  const { source, threadId } = args
  const podAwake = args.podAwake ?? true
  const refreshKey = args.refreshKey ?? 0
  const [view, setView] = useState<FileTreeView>(LOADING)
  const [open, setOpenState] = useState<string[]>(
    () => recallThreadPanel(threadId).openFolders ?? [],
  )
  const openRef = useRef<string[]>(open)
  const listed = useRef<Set<string>>(new Set())

  const store = useCallback((entries: ReadonlyMap<string, TreeEntry[]>) => {
    setView((previous) => {
      const listings = new Map(previous.status === EFileTreeStatus.Ready ? previous.listings : [])
      for (const [directory, list] of entries) listings.set(directory, list)
      return { status: EFileTreeStatus.Ready, listings }
    })
  }, [])

  useEffect(() => {
    if (source === null || !podAwake) return
    let current = true
    const directories = [ROOT_DIRECTORY, ...openRef.current]
    Promise.all(
      directories.map(async (directory) => {
        const entries = await listOrEmpty({ source, directory })
        return [directory, entries] as const
      }),
    )
      .then((results) => {
        if (!current) return
        listed.current = new Set(directories)
        store(new Map(results))
      })
      .catch((error: unknown) => {
        if (current)
          setView({
            status: EFileTreeStatus.Failed,
            message: messageOfFailure(error),
          })
      })
    return () => {
      current = false
    }
  }, [source, refreshKey, podAwake, store])

  const setOpen = useCallback(
    (change: { directory: string; open: boolean }) => {
      const { directory } = change
      const next = change.open
        ? [...openRef.current.filter((path) => path !== directory), directory]
        : openRef.current.filter((path) => path !== directory)
      openRef.current = next
      setOpenState(next)
      rememberThreadPanel({ threadId, patch: { openFolders: next } })
      if (!change.open || source === null || listed.current.has(directory)) return
      listed.current.add(directory)
      listOrEmpty({ source, directory }).then((entries) => store(new Map([[directory, entries]])))
    },
    [source, store, threadId],
  )

  return { view, open, setOpen }
}
