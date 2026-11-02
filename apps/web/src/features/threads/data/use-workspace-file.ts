'use client'

import { useEffect, useState } from 'react'

import type { WorkspaceFileWire } from '@dltech/atlas-wire/web'

import { readWorkspaceFile, type WorkspaceFileChannel } from './workspace-file-source'

export type LoadedWorkspaceFile =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; file: WorkspaceFileWire }

export function useWorkspaceFile(args: {
  channel: WorkspaceFileChannel | null
  path: string
  refreshKey: number
}): LoadedWorkspaceFile {
  const { channel, path, refreshKey } = args
  const [settled, setSettled] = useState<{
    path: string
    result: LoadedWorkspaceFile
  } | null>(null)

  useEffect(() => {
    if (channel === null) return undefined
    let active = true
    readWorkspaceFile({ channel, path }).then(
      (file) => active && setSettled({ path, result: { state: 'ready', file } }),
      () => active && setSettled({ path, result: { state: 'failed' } }),
    )
    return () => {
      active = false
    }
  }, [channel, path, refreshKey])

  if (settled === null || settled.path !== path) return { state: 'loading' }
  return settled.result
}
