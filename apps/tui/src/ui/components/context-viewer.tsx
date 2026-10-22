import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BoxRenderable, ScrollBoxRenderable } from '@opentui/core'
import { createUrlOpener, type ContextFileContent } from '@dltech/atlas-harness'

import { openFileInEditor } from '../../composition/file-opener'
import { cellsOf } from '../hint-layout'
import '../images/viewer-image'
import { useClickRegion } from '../hooks/use-click-region'
import { useContextLinkScope } from '../hooks/use-context-link-scope'
import { CopyButton } from '../markdown/copy-button'
import { HorizontalScroller } from '../markdown/horizontal-scroller'
import { fetchMermaidPng, mermaidLiveUrl, mermaidSources } from '../markdown/mermaid'
import { observeScroll } from '../scroll-signal'
import { glyph, theme } from '../theme'
import { BackPill } from './back-pill'
import { CodeLines } from './blocks/tool-code-lines'
import { Panel, PANEL_INSET, PANEL_PAD } from './panel'
import { MarkdownView } from '../markdown/markdown-view'

const VIEWPORT_PAD = 2

const LEFT_PAD = 2

export const isMarkdownPath = (path: string): boolean => /\.(md|markdown)$/i.test(path)

function ActionButton(props: { label: string; onPress: () => void }): React.ReactNode {
  const { handlers, hovered, wash } = useClickRegion(props.onPress)
  return (
    <text fg={hovered ? theme.hover : theme.dim} selectable={false} {...wash} {...handlers}>
      {` ${props.label} `}
    </text>
  )
}

function MermaidDiagram(props: { source: string }): React.ReactNode {
  const [png, setPng] = useState<Buffer | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setPng(null)
    setFailed(false)
    void fetchMermaidPng({ source: props.source }).then((bytes) => {
      if (!live) return
      if (bytes === null) setFailed(true)
      else setPng(bytes)
    })
    return () => {
      live = false
    }
  }, [props.source])

  if (failed) {
    return (
      <text fg={theme.warn}>
        the diagram could not be rendered (mermaid.ink unreachable) — showing source instead
      </text>
    )
  }
  if (png === null) {
    return <text fg={theme.hint}>Rendering diagram…</text>
  }
  return (
    <viewer-image
      source={png}
      protocol="auto"
      fit="fit"
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
    />
  )
}

function TextBody(props: {
  content: ContextFileContent & { type: 'text' }
  path: string
  width: number
  viewport: number
  window: { start: number; end: number }
}): React.ReactNode {
  const lines = useMemo(
    () =>
      props.content.content.split('\n').map((value, index) => ({ number: index + 1, text: value })),
    [props.content.content],
  )
  const widest = useMemo(
    () => lines.reduce((max, line) => Math.max(max, cellsOf(line.text)), 0),
    [lines],
  )
  const digits = useMemo(
    () => lines.reduce((max, line) => Math.max(max, String(line.number).length), 2),
    [lines],
  )
  const markdown = isMarkdownPath(props.path)

  if (markdown) {
    return <MarkdownView source={props.content.content} width={Math.max(1, props.width)} />
  }

  // CodeLines clips each row to the columns it is given, so at the panel width there is nothing to
  // pan. Render the code at its natural width and let the scroller clip it instead — that is what
  // the pan bar reaches.
  if (widest <= props.width) {
    return (
      <CodeLines
        lines={lines}
        path={props.path}
        inner={Math.max(1, props.width)}
        indent=""
        window={props.window}
      />
    )
  }
  const natural = digits + 1 + widest
  return (
    <HorizontalScroller rows={lines.length} columns={natural} width={props.width}>
      <CodeLines lines={lines} path={props.path} inner={natural} indent="" window={props.window} />
    </HorizontalScroller>
  )
}

export function ContextViewer(props: {
  width: number
  path: string
  loading: boolean
  content: ContextFileContent | null
  localFilePath?: string | null
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
  const attach = useCallback(
    (box: ScrollBoxRenderable | null) => {
      release.current?.()
      release.current = null
      props.attachScroll(box)
      if (box === null) return
      const update = () => {
        const start = Math.max(0, Math.floor(box.scrollTop) - 12)
        const end = Math.ceil(box.scrollTop + box.viewport.height) + 12
        setWindow((current) =>
          current.start === start && current.end === end ? current : { start, end },
        )
      }
      release.current = observeScroll(box, update)
      update()
    },
    [props.attachScroll],
  )
  useEffect(
    () => () => {
      release.current?.()
    },
    [],
  )

  const copyText = props.content?.type === 'text' ? props.content.content : null
  const localFilePath = props.localFilePath ?? null
  const handleOpen = useCallback(() => {
    if (localFilePath !== null) openFileInEditor({ path: localFilePath })
  }, [localFilePath])

  const diagrams = useMemo(
    () =>
      props.content?.type === 'text'
        ? mermaidSources({ path: props.path, content: props.content.content })
        : [],
    [props.content, props.path],
  )
  const diagram = diagrams[0]
  const [showDiagram, setShowDiagram] = useState(true)
  const urlOpener = useMemo(() => createUrlOpener(), [])
  const handleOpenLive = useCallback(() => {
    if (diagram !== undefined) urlOpener(mermaidLiveUrl(diagram))
  }, [diagram, urlOpener])
  const handleToggle = useCallback(() => setShowDiagram((value) => !value), [])

  const viewport = Math.max(1, props.width - LEFT_PAD - VIEWPORT_PAD)
  const inner = Math.max(1, viewport - PANEL_INSET - PANEL_PAD)
  const diagramMode = diagram !== undefined && showDiagram && imageBytes === null

  return (
    <box
      ref={pane}
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      paddingLeft={LEFT_PAD}
    >
      <box flexDirection="row" flexShrink={0} paddingTop={1} paddingBottom={1} alignItems="center">
        <BackPill label="context" onBack={props.onDismiss} />
        {props.loading || props.content === null ? null : (
          <box
            flexGrow={1}
            flexShrink={1}
            justifyContent="flex-end"
            flexDirection="row"
            alignItems="center"
          >
            {diagram === undefined ? null : (
              <>
                <ActionButton label={showDiagram ? 'source' : 'diagram'} onPress={handleToggle} />
                <ActionButton label={`${glyph.external} live`} onPress={handleOpenLive} />
              </>
            )}
            <text fg={theme.hint} wrapMode="none" flexShrink={1}>
              {props.path}
            </text>
            {localFilePath === null ? null : (
              <ActionButton label={`${glyph.external} open`} onPress={handleOpen} />
            )}
            {copyText === null ? null : <CopyButton text={copyText} />}
          </box>
        )}
      </box>
      {props.loading ? (
        <text fg={theme.hint}>Reading {props.path}…</text>
      ) : props.content === null ? null : imageBytes !== null ? (
        <viewer-image
          source={imageBytes}
          protocol="auto"
          fit="fit"
          flexGrow={1}
          flexShrink={1}
          flexBasis={0}
        />
      ) : diagramMode ? (
        <box flexGrow={1} flexShrink={1} flexBasis={0}>
          <MermaidDiagram source={diagram} />
        </box>
      ) : (
        <scrollbox ref={attach} flexGrow={1} flexShrink={1} flexBasis={0} viewportCulling>
          <Panel rail={theme.rule} fill={theme.panelBg} width={viewport}>
            {props.content.type === 'refused' ? (
              <text fg={theme.warn}>{props.content.reason}</text>
            ) : props.content.type !== 'text' ? null : (
              <TextBody
                content={props.content}
                path={props.path}
                width={inner}
                viewport={viewport}
                window={window}
              />
            )}
          </Panel>
        </scrollbox>
      )}
      <text fg={theme.hint} flexShrink={0}>
        ↑↓ scroll · ←→ pan · pgup/pgdn page · esc to close
      </text>
    </box>
  )
}
