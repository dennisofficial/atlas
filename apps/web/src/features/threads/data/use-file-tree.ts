'use client'

import { useEffect, useState } from 'react'

import { crawlDirectories } from './file-tree-crawl'
import { messageOfFailure } from './git-changes-load'
import type { DirectoryListings } from './file-tree-nodes'
import type { FileTreeChannel } from './file-tree-source'

export enum EFileTreeStatus {
  Loading = 'loading',
  Ready = 'ready',
  Failed = 'failed',
}

export type FileTreeView =
  | { status: EFileTreeStatus.Loading }
  | { status: EFileTreeStatus.Ready; listings: DirectoryListings }
  | { status: EFileTreeStatus.Failed; message: string }

const LOADING: FileTreeView = { status: EFileTreeStatus.Loading }

export function useFileTree(args: {
  channel: FileTreeChannel | null
  refreshKey: number
}): FileTreeView {
  const { channel, refreshKey } = args
  const [view, setView] = useState<FileTreeView>(LOADING)

  useEffect(() => {
    if (channel === null) return
    let current = true
    const crawl = crawlDirectories({
      channel,
      isCancelled: () => !current,
      onListing: ({ directory, entries }) => {
        if (!current) return
        setView((previous) => {
          const listings = new Map(
            previous.status === EFileTreeStatus.Ready ? previous.listings : [],
          )
          listings.set(directory, entries)
          return { status: EFileTreeStatus.Ready, listings }
        })
      },
    })
    crawl.catch((error: unknown) => {
      if (current)
        setView({
          status: EFileTreeStatus.Failed,
          message: messageOfFailure(error),
        })
    })
    return () => {
      current = false
    }
  }, [channel, refreshKey])

  return view
}
