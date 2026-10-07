import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BoxRenderable, ScrollBoxRenderable } from '@opentui/core'
import type { ContextFileContent } from '@dltech/atlas-harness'

import { cellsOf } from '../hint-layout'
import '../images/viewer-image'
import { useContextLinkScope } from '../hooks/use-context-link-scope'
import { observeScroll } from '../scroll-signal'
import { theme } from '../theme'
import { BackPill } from './back-pill'
import { CodeLines } from './blocks/tool-code-lines'
import { MarkdownView } from '../markdown/markdown-view'

const VIEWPORT_PAD = 2

const LEFT_PAD = 2

export const isMarkdownPath = (path: string): boolean => /\.(md|markdown)$/i.test(path)

function ViewerBody(props: {
  content: ContextFileContent
  path: string
  viewport: number
  window: { start: number; end: number }
}): React.ReactNode {
  const text = props.content.type === 'text' ? props.content.content : ''
  const lines = useMemo(() => text.split('\n').map((value, index) => ({ number: index + 1, text: value })), [text])
  const digits = useMemo(() => lines.reduce((max, line) => Math.max(max, String(line.number).length), 2), [lines])
  const widest = useMemo(() => lines.reduce((max, line) => Math.max(max, cellsOf(line.text)), 0), [lines])
  if (props.content.type === 'refused') return <text fg={theme.warn}>{props.content.reason}</text>
  if (props.content.type !== 'text') return null
  if (isMarkdownPath(props.path)) {
    return <MarkdownView source={props.content.content} width={Math.max(1, props.viewport)} />
  }
  const inner = Math.max(props.viewport, digits + 1 + widest)
  return <CodeLines lines={lines} path={props.path} inner={inner} indent="" window={props.window} />
}

export function ContextViewer(props: {
  width: number
  path: string
  loading: boolean
  content: ContextFileContent | null
  onDismiss: () => void
  onNavigate?: (path: string) => void
  attachScroll: (box: ScrollBoxRenderable | null) => void
}): React.ReactNode {
  const image = props.content?.type === 'image' ? props.content.data : null
  const imageBytes = useMemo(() => (image === null ? null : Buffer.from(image, 'base64')), [image])
  const [window, setWindow] = useState({ start: 0, end: 100 })
  const release = useRef<(() => void) | null>(null)
  const pane = useRef<BoxRenderable | null>(null)
  useContextLinkScope({ box: pane, path: props.path, onNavigate: props.onNavigate })
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
    <box ref={pane} flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} paddingLeft={LEFT_PAD}>
      <box flexDirection="row" flexShrink={0} paddingTop={1} paddingBottom={1}>
        <BackPill label="context" onBack={props.onDismiss} />
        <box flexGrow={1} flexShrink={1} justifyContent="flex-end" flexDirection="row">
          <text fg={theme.hint} wrapMode="none" flexShrink={1}>{props.path}</text>
        </box>
      </box>
      {props.loading ? <text fg={theme.hint}>Reading {props.path}…</text> : props.content === null ? null :
        imageBytes !== null ? (
          <viewer-image source={imageBytes} protocol="auto" fit="fit" flexGrow={1} flexShrink={1} flexBasis={0} />
        ) : (
          <scrollbox ref={attach} scrollX flexGrow={1} flexShrink={1} flexBasis={0} viewportCulling>
            <ViewerBody content={props.content} path={props.path} viewport={Math.max(1, props.width - LEFT_PAD - VIEWPORT_PAD)} window={window} />
          </scrollbox>
        )}
      <text fg={theme.hint} flexShrink={0}>↑↓ scroll · ←→ pan · pgup/pgdn page · esc to close</text>
    </box>
  )
}
