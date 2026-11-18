'use client'

import { useEffect, useState } from 'react'

import { messageOfFailure } from './git-changes-load'
import { isSearchUnsupported } from './file-search-source'
import type { FileSource } from './file-source'

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

type Settled = { query: string; view: FileSearchView }

export function useFileSearch(args: {
  source: FileSource | null
  query: string
  refreshKey?: number
}): FileSearchView {
  const { source } = args
  const refreshKey = args.refreshKey ?? 0
  const query = args.query.trim()
  const [settled, setSettled] = useState<Settled | null>(null)

  useEffect(() => {
    if (query === '' || source === null) return undefined
    let active = true
    const timer = setTimeout(() => {
      source.search({ query }).then(
        (reply) =>
          active &&
          setSettled({
            query,
            view: { status: EFileSearchStatus.Ready, ...reply },
          }),
        (failure: unknown) =>
          active &&
          setSettled({
            query,
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
  }, [source, query, refreshKey])

  if (query === '') return { status: EFileSearchStatus.Idle }
  if (settled === null || settled.query !== query) return { status: EFileSearchStatus.Loading }
  return settled.view
}
