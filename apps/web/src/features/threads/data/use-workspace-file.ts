'use client'

import { useEffect, useState } from 'react'

import type { WorkspaceFileWire } from '@dltech/atlas-wire/web'

import type { FileSource } from './file-source'

export type LoadedWorkspaceFile =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; file: WorkspaceFileWire }

export function useWorkspaceFile(args: {
  source: FileSource | null
  path: string
  refreshKey?: number
  podAwake?: boolean
}): LoadedWorkspaceFile {
  const { source, path } = args
  const podAwake = args.podAwake ?? true
  const refreshKey = args.refreshKey ?? 0
  const [settled, setSettled] = useState<{
    path: string
    result: LoadedWorkspaceFile
  } | null>(null)

  useEffect(() => {
    if (source === null || !podAwake) return undefined
    let active = true
    source.read({ path }).then(
      (file) => active && setSettled({ path, result: { state: 'ready', file } }),
      () => active && setSettled({ path, result: { state: 'failed' } }),
    )
    return () => {
      active = false
    }
  }, [source, path, refreshKey, podAwake])

  if (settled === null || settled.path !== path) return { state: 'loading' }
  return settled.result
}
