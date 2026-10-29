'use client'

import { useEffect, useState } from 'react'

import type { ContextFileContentWire } from '@dltech/atlas-wire/web'

import { readContextFile } from '../data/context-files-source'
import type { ServeChannel } from '../data/live-thread-view'

export type LoadedContextFile =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; file: ContextFileContentWire }

export function useContextFile(args: {
  channel: ServeChannel | null
  path: string
}): LoadedContextFile {
  const { channel, path } = args
  const [loaded, setLoaded] = useState<{
    channel: ServeChannel | null
    path: string
    result: LoadedContextFile
  } | null>(null)

  useEffect(() => {
    if (channel === null) return undefined
    let active = true
    const settle = (result: LoadedContextFile) => {
      if (active) setLoaded({ channel, path, result })
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
  }, [channel, path])

  if (channel === null) return { state: 'failed' }
  if (loaded === null || loaded.channel !== channel || loaded.path !== path) {
    return { state: 'loading' }
  }
  return loaded.result
}
