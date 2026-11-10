'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { ArrowLeftIcon, CheckIcon, CopyIcon, DownloadIcon } from 'lucide-react'

import { CodeViewer } from '@dltech/atlas-ui/ai/code-viewer'
import { MessageResponse } from '@dltech/atlas-ui/ai/message-response'
import { Button } from '@dltech/atlas-ui/components/button'
import { languageOfPath } from '@dltech/atlas-ui/lib/language-of-path'
import type { ContextFileContentWire } from '@dltech/atlas-wire/web'

import { useThreadPanel } from '../panel/thread-panel-context'
import {
  copyTextOf,
  downloadNameOf,
  downloadOf,
  EContextView,
  fileSizeLabelOf,
  isMarkdownPath,
  renderableHtmlOf,
} from './context-model'
import { ContextViewToggle, HtmlFrame } from './html-view'
import { type LoadedContextFile, useContextFile } from './use-context-file'

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timeout = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timeout)
  }, [copied])
  const handleCopy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => undefined)
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? 'Copied' : 'Copy content'}
      onClick={handleCopy}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

export function Notice({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

function ProseColumn({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-6">{children}</div>
    </div>
  )
}

export function DownloadButton(props: {
  file: ContextFileContentWire
  path: string
  labelled?: boolean
}) {
  if (props.file.type === 'refused') return null
  const name = downloadNameOf(props.path)
  const handleDownload = () => {
    const blob = downloadOf(props.file)
    if (blob === null) return
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.click()
    URL.revokeObjectURL(url)
  }
  if (props.labelled === true) {
    return (
      <Button variant="outline" size="sm" onClick={handleDownload}>
        <DownloadIcon />
        Download
      </Button>
    )
  }
  return (
    <Button variant="ghost" size="icon-sm" aria-label={`Download ${name}`} onClick={handleDownload}>
      <DownloadIcon />
    </Button>
  )
}

export function ContextFileBody(props: { loaded: LoadedContextFile; path: string }) {
  const { loaded, path } = props
  if (loaded.state === 'loading') {
    return (
      <ProseColumn>
        <Notice>Reading file…</Notice>
      </ProseColumn>
    )
  }
  if (loaded.state === 'failed') {
    return (
      <ProseColumn>
        <Notice>File unavailable</Notice>
      </ProseColumn>
    )
  }
  const { file } = loaded
  if (file.type === 'refused') {
    return (
      <ProseColumn>
        <Notice>{file.reason}</Notice>
      </ProseColumn>
    )
  }
  if (file.type === 'binary') {
    return (
      <ProseColumn>
        <Notice>{`Binary file · ${fileSizeLabelOf(file.bytes)}`}</Notice>
        <DownloadButton file={file} path={path} labelled />
      </ProseColumn>
    )
  }
  if (file.type === 'image') {
    return (
      <ProseColumn>
        {/* biome-ignore lint/performance/noImgElement: next/image cannot optimize a data: URL */}
        <img
          src={`data:${file.mediaType};base64,${file.data}`}
          alt={path}
          className="h-auto w-auto max-w-full self-start"
        />
      </ProseColumn>
    )
  }
  if (!isMarkdownPath(path)) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">
          <CodeViewer path={path} content={file.content} language={languageOfPath(path)} />
        </div>
        {file.truncated ? <Notice>Truncated</Notice> : null}
      </div>
    )
  }
  return (
    <ProseColumn>
      <MessageResponse>{file.content}</MessageResponse>
      {file.truncated ? <Notice>Truncated</Notice> : null}
    </ProseColumn>
  )
}

export function ContextViewer({ path }: { path: string }) {
  const { threadId, channel, closeContextFile } = useThreadPanel()
  const loaded = useContextFile({ threadId, channel, path })
  const [view, setView] = useState(EContextView.Rendered)
  const text = loaded.state === 'ready' ? copyTextOf(loaded.file) : null
  const html = loaded.state === 'ready' ? renderableHtmlOf({ file: loaded.file, path }) : null
  const showsFrame = html !== null && view === EContextView.Rendered

  return (
    <section aria-label="Context file" className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="sm" aria-label="Back" onClick={closeContextFile}>
          <ArrowLeftIcon />
          Back
        </Button>
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={path}>
          {path}
        </p>
        {html === null ? null : <ContextViewToggle value={view} onValueChange={setView} />}
        {text === null ? null : <CopyButton text={text} />}
        {loaded.state === 'ready' ? <DownloadButton file={loaded.file} path={path} /> : null}
      </header>
      {showsFrame ? (
        <div className="min-h-0 flex-1">
          <HtmlFrame html={html} title={path} />
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <ContextFileBody loaded={loaded} path={path} />
        </div>
      )}
    </section>
  )
}
