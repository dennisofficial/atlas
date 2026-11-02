'use client'

import { useEffect, useState } from 'react'

import { messageOfFailure } from './git-changes-load'
import {
  isSearchUnsupported,
  searchWorkspaceFiles,
  type FileSearchChannel,
} from './file-search-source'

export const SEARCH_DEBOUNCE_MS = 120

export enum EFileSearchStatus {
  Idle = 'idle',
  Loading = 'loading',
  Ready = 'ready',
  Unsupported = 'unsupported',
  Failed = 'failed',
}

export type FileSearchView =
  | { status: EFileSearchStatus.Idle }
  | { status: EFileSearchStatus.Loading }
  | {
      status: EFileSearchStatus.Ready
      paths: { path: string; positions: number[] }[]
      truncated: boolean
    }
  | { status: EFileSearchStatus.Unsupported }
  | { status: EFileSearchStatus.Failed; message: string }

type Settled = { query: string; refreshKey: number; view: FileSearchView }

export function useFileSearch(args: {
  channel: FileSearchChannel
  query: string
  refreshKey: number
}): FileSearchView {
  const { channel, refreshKey } = args
  const query = args.query.trim()
  const [settled, setSettled] = useState<Settled | null>(null)

  useEffect(() => {
    if (query === '') return undefined
    let active = true
    const timer = setTimeout(() => {
      searchWorkspaceFiles({ channel, query }).then(
        (reply) =>
          active &&
          setSettled({
            query,
            refreshKey,
            view: { status: EFileSearchStatus.Ready, ...reply },
          }),
        (failure: unknown) =>
          active &&
          setSettled({
            query,
            refreshKey,
            view: isSearchUnsupported(failure)
              ? { status: EFileSearchStatus.Unsupported }
              : { status: EFileSearchStatus.Failed, message: messageOfFailure(failure) },
          }),
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [channel, query, refreshKey])

  if (query === '') return { status: EFileSearchStatus.Idle }
  if (settled === null || settled.query !== query) return { status: EFileSearchStatus.Loading }
  return settled.view
}
