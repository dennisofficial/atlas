'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { messageOfFailure } from './git-changes-load'
import { ROOT_DIRECTORY, browseDirectory } from './file-tree-source'
import type { DirectoryListings } from './file-tree-nodes'
import type { FileTreeChannel, TreeEntry } from './file-tree-source'

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

async function listOrEmpty(args: {
  channel: FileTreeChannel
  directory: string
}): Promise<TreeEntry[]> {
  return browseDirectory(args).catch((error: unknown) => {
    if (args.directory === ROOT_DIRECTORY) throw error
    return []
  })
}

export function useFileTree(args: {
  channel: FileTreeChannel | null
  refreshKey: number
}): FileTreeState {
  const { channel, refreshKey } = args
  const [view, setView] = useState<FileTreeView>(LOADING)
  const [open, setOpenState] = useState<string[]>([])
  const openRef = useRef<string[]>([])
  const listed = useRef<Set<string>>(new Set())

  const store = useCallback((entries: ReadonlyMap<string, TreeEntry[]>) => {
    setView((previous) => {
      const listings = new Map(previous.status === EFileTreeStatus.Ready ? previous.listings : [])
      for (const [directory, list] of entries) listings.set(directory, list)
      return { status: EFileTreeStatus.Ready, listings }
    })
  }, [])

  useEffect(() => {
    if (channel === null) return
    let current = true
    const directories = [ROOT_DIRECTORY, ...openRef.current]
    Promise.all(
      directories.map(async (directory) => {
        const entries = await listOrEmpty({ channel, directory })
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
  }, [channel, refreshKey, store])

  const setOpen = useCallback(
    (change: { directory: string; open: boolean }) => {
      const { directory } = change
      const next = change.open
        ? [...openRef.current.filter((path) => path !== directory), directory]
        : openRef.current.filter((path) => path !== directory)
      openRef.current = next
      setOpenState(next)
      if (!change.open || channel === null || listed.current.has(directory)) return
      listed.current.add(directory)
      listOrEmpty({ channel, directory }).then((entries) => store(new Map([[directory, entries]])))
    },
    [channel, store],
  )

  return { view, open, setOpen }
}
