import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { ContextFileContent } from '@dltech/atlas-harness'

import { observeScroll } from '../scroll-signal'
import { theme } from '../theme'
import { BackPill } from './back-pill'
import { CodeLines } from './blocks/tool-code-lines'

function ViewerBody(props: {
  content: ContextFileContent
  path: string
  inner: number
  window: { start: number; end: number }
}): React.ReactNode {
  const text = props.content.type === 'text' ? props.content.content : ''
  const lines = useMemo(() => text.split('\n').map((value, index) => ({ number: index + 1, text: value })), [text])
  if (props.content.type === 'refused') return <text fg={theme.warn}>{props.content.reason}</text>
  return <CodeLines lines={lines} path={props.path} inner={props.inner} indent="" window={props.window} />
}

export function ContextViewer(props: {
  width: number
  path: string
  loading: boolean
  content: ContextFileContent | null
  onDismiss: () => void
  attachScroll: (box: ScrollBoxRenderable | null) => void
}): React.ReactNode {
  const [window, setWindow] = useState({ start: 0, end: 100 })
  const release = useRef<(() => void) | null>(null)
  const attach = useCallback((box: ScrollBoxRenderable | null) => {
    release.current?.()
    release.current = null
    props.attachScroll(box)
    if (box === null) return
    const update = () => {
      const start = Math.max(0, Math.floor(box.scrollTop) - 12)
      const end = Math.ceil(box.scrollTop + box.viewport.height) + 12
      setWindow((current) => current.start === start && current.end === end ? current : { start, end })
    }
    release.current = observeScroll(box, update)
    update()
  }, [props.attachScroll])
  useEffect(() => () => { release.current?.() }, [])

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0}>
      <box flexDirection="row" flexShrink={0} paddingTop={1} paddingBottom={1}>
        <BackPill label="context" onBack={props.onDismiss} />
        <box flexGrow={1} flexShrink={1} justifyContent="flex-end" flexDirection="row">
          <text fg={theme.hint} wrapMode="none" flexShrink={1}>{props.path}</text>
        </box>
      </box>
      {props.loading ? <text fg={theme.hint}>Reading {props.path}…</text> : props.content === null ? null : (
        <scrollbox ref={attach} flexGrow={1} flexShrink={1} flexBasis={0} viewportCulling>
          <ViewerBody content={props.content} path={props.path} inner={Math.max(1, props.width - 2)} window={window} />
        </scrollbox>
      )}
      <text fg={theme.hint} flexShrink={0}>↑↓ scroll · pgup/pgdn page · esc to close</text>
    </box>
  )
}
