'use client'

import { useEffect, useState } from 'react'

import type { ContextFileContentWire } from '@dltech/atlas-wire/web'

import Image from 'next/image'

import { readContextFile } from '../../data/context-files-source'
import type { ServeChannel } from '../../data/live-thread-view'
import { Muted } from './section'

type Loaded =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; file: ContextFileContentWire }

export function ContextFileViewer(props: { path: string; channel: ServeChannel }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const { channel, path } = props

  useEffect(() => {
    let active = true
    readContextFile({ channel, path }).then(
      (file) => active && setLoaded({ state: 'ready', file }),
      () => active && setLoaded({ state: 'failed' }),
    )
    return () => {
      active = false
    }
  }, [channel, path])

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="truncate font-mono text-xs text-muted-foreground" title={props.path}>
        {props.path}
      </p>
      <ViewerBody loaded={loaded} />
    </div>
  )
}

function ViewerBody({ loaded }: { loaded: Loaded }) {
  if (loaded.state === 'loading') return <Muted>Reading file…</Muted>
  if (loaded.state === 'failed') return <Muted>File unavailable</Muted>
  const { file } = loaded
  if (file.type === 'refused') return <Muted>{file.reason}</Muted>
  if (file.type === 'image') {
    return (
      <Image
        unoptimized
        src={`data:${file.mediaType};base64,${file.data}`}
        alt=""
        width={0}
        height={0}
        className="h-auto max-w-full"
      />
    )
  }
  return (
    <>
      <pre className="overflow-auto font-mono text-xs whitespace-pre-wrap">{file.content}</pre>
      {file.truncated ? <Muted>Truncated</Muted> : null}
    </>
  )
}
