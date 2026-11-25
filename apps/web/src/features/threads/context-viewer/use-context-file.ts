'use client'

import { useEffect, useState } from 'react'

import type { ContextFileContentWire } from '@dltech/atlas-wire/web'

import { readContextFile } from '../data/context-files-source'
import type { LiveChannel } from '../data/live-channel'

export type LoadedContextFile =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; file: ContextFileContentWire }

export function useContextFile(args: {
  threadId: string
  channel: LiveChannel | null
  path: string
}): LoadedContextFile {
  const { threadId, channel, path } = args
  type SourceKey = LiveChannel | 'api'
  const sourceKey: SourceKey = channel ?? 'api'
  const [loaded, setLoaded] = useState<{
    key: SourceKey | null
    path: string
    result: LoadedContextFile
  } | null>(null)

  useEffect(() => {
    let active = true
    const settle = (result: LoadedContextFile) => {
      if (active) setLoaded({ key: sourceKey, path, result })
    }

    if (channel === null) {
      settle({ state: 'failed' })
      return () => {
        active = false
      }
    }

    const read = () =>
      readContextFile({ channel, path }).then(
        (file) => settle({ state: 'ready', file }),
        () => settle({ state: 'failed' }),
      )
    void read()
    const off = channel.subscribe({
      threadId: channel.threadId,
      listener: (signal) => {
        if (signal.type === 'context-changed') void read()
      },
    })
    const offReload = channel.onReload(() => void read())
    const offReady = channel.onReady(() => void read())
    return () => {
      active = false
      off()
      offReload()
      offReady()
    }
  }, [threadId, channel, sourceKey, path])

  if (loaded === null || loaded.key !== sourceKey || loaded.path !== path) {
    return { state: 'loading' }
  }
  return loaded.result
}
