'use client'

import { useEffect, useState } from 'react'

import type { ContextFileContentWire } from '@dltech/atlas-wire/web'

import {
  CONTEXT_API_POLL_MS,
  readContextFile,
  readContextFileFromApi,
} from '../data/context-files-source'
import type { ServeChannel } from '../data/live-thread-view'

export type LoadedContextFile =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; file: ContextFileContentWire }

export function useContextFile(args: {
  threadId: string
  channel: ServeChannel | null
  path: string
}): LoadedContextFile {
  const { threadId, channel, path } = args
  type SourceKey = ServeChannel | 'api'
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
      const read = () =>
        readContextFileFromApi({ threadId, path }).then(
          (file) => settle({ state: 'ready', file }),
          () => settle({ state: 'failed' }),
        )
      void read()
      const interval = setInterval(() => void read(), CONTEXT_API_POLL_MS)
      return () => {
        active = false
        clearInterval(interval)
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
