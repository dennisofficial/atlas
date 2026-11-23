'use client'

import { ArrowLeftIcon, DownloadIcon } from 'lucide-react'
import { useState } from 'react'

import { CodeViewer } from '@dltech/atlas-ui/ai/code-viewer'
import { Button } from '@dltech/atlas-ui/components/button'
import { languageOfPath } from '@dltech/atlas-ui/lib/language-of-path'

import type { ContextMirrorFile } from '@dltech/atlas-protocol'

import {
  EContextView,
  fileSizeLabelOf,
  renderKindOf,
} from '@/features/threads/context-viewer/context-model'
import { Notice } from '@/features/threads/context-viewer/context-viewer'
import { ContextViewToggle } from '@/features/threads/context-viewer/html-view'
import { RenderedFile } from '@/features/threads/context-viewer/rendered-file'
import { lineMarksOf } from '@/features/threads/data/line-marks'

import { useContextFile, useContextMirrorRefresh } from '../data/context-files'
import { useSessionPaneValue } from '../panel/pane-value'

function TextBody(props: { path: string; content: string; rendered: boolean }) {
  const renderKind = renderKindOf(props.path)
  if (props.rendered && renderKind !== null) {
    return <RenderedFile kind={renderKind} content={props.content} path={props.path} />
  }
  return (
    <CodeViewer
      path={props.path}
      content={props.content}
      language={languageOfPath(props.path)}
      marks={lineMarksOf([])}
    />
  )
}

function ImageBody(props: { file: Extract<ContextMirrorFile, { type: 'image' }> }) {
  return (
    <>
      {/* biome-ignore lint/performance/noImgElement: next/image cannot optimize a presigned R2 URL */}
      <img
        src={props.file.url}
        alt={props.file.path}
        className="mx-auto max-h-full max-w-full object-contain"
      />
    </>
  )
}

function BinaryBody(props: { file: Extract<ContextMirrorFile, { type: 'binary' }> }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-xs text-muted-foreground">{props.file.path}</p>
      <p className="text-xs text-muted-foreground">
        {props.file.mime} · {fileSizeLabelOf(props.file.bytes)}
      </p>
      <a href={props.file.url} download className="w-fit">
        <Button variant="outline" size="sm">
          <DownloadIcon />
          Download
        </Button>
      </a>
    </div>
  )
}

function ContextFileBody(props: { file: ContextMirrorFile; rendered: boolean }) {
  const { file } = props
  if (file.type === 'refused') return <Notice>{file.reason}</Notice>
  if (file.type === 'image') return <ImageBody file={file} />
  if (file.type === 'binary') return <BinaryBody file={file} />
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <TextBody path={file.path} content={file.content} rendered={props.rendered} />
      </div>
      {file.truncated ? <Notice>Truncated</Notice> : null}
    </div>
  )
}

export function ContextFileView(props: { sessionId: string; path: string; onBack: () => void }) {
  const { contextChanged, turnEnds } = useSessionPaneValue()
  useContextMirrorRefresh({ sessionId: props.sessionId, changed: contextChanged, turnEnds })
  const query = useContextFile({ sessionId: props.sessionId, path: props.path })
  const file = query.data?.file
  const renderKind = renderKindOf(props.path)
  const [renderedPath, setRenderedPath] = useState<string | null>(null)
  const rendered = renderKind !== null && renderedPath === props.path
  const handleViewChange = (next: EContextView) =>
    setRenderedPath(next === EContextView.Rendered ? props.path : null)

  return (
    <section data-context-file={props.path} className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="sm" onClick={props.onBack}>
          <ArrowLeftIcon />
          Back
        </Button>
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          Context · {props.path}
        </p>
        {file?.type !== 'text' || renderKind === null ? null : (
          <ContextViewToggle
            value={rendered ? EContextView.Rendered : EContextView.Source}
            onValueChange={handleViewChange}
          />
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {query.isPending ? <Notice>Reading file…</Notice> : null}
        {query.isError ? <Notice>File unavailable</Notice> : null}
        {file === undefined ? null : <ContextFileBody file={file} rendered={rendered} />}
      </div>
    </section>
  )
}
