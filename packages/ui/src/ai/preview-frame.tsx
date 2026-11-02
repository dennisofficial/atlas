'use client'

import { useState } from 'react'
import { ExternalLinkIcon, LockIcon, RotateCwIcon } from 'lucide-react'

import { Button } from '#components/button'
import { cn } from '#lib/utils'
import { EStatusTone, StatusDot } from './internal/status-dot'
import {
  EPreviewStatus,
  PREVIEW_STATUS_LABEL,
  selectedPortOf,
  type PreviewPort,
} from './preview-ports'

export { EPreviewStatus, selectedPortOf, type PreviewPort } from './preview-ports'

export interface PreviewFrameProps {
  ports: PreviewPort[]
  selectedId?: string
  onSelect: (id: string) => void
  src?: string
  title?: string
}

const STATUS_TONE: Record<EPreviewStatus, EStatusTone> = {
  [EPreviewStatus.Live]: EStatusTone.Live,
  [EPreviewStatus.Starting]: EStatusTone.Pending,
  [EPreviewStatus.Stopped]: EStatusTone.Idle,
}

interface PortRowProps {
  preview: PreviewPort
  selected: boolean
  onSelect: (id: string) => void
}

function PortRow({ preview, selected, onSelect }: PortRowProps) {
  const handleSelect = () => onSelect(preview.id)

  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={handleSelect}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset',
          selected && 'bg-muted',
        )}
      >
        <StatusDot tone={STATUS_TONE[preview.status]} />
        <span className="shrink-0 text-foreground">{preview.label}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {preview.url}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {PREVIEW_STATUS_LABEL[preview.status]}
        </span>
        <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
          :{preview.port}
        </span>
      </button>
    </li>
  )
}

function OfflineNotice({ preview }: { preview: PreviewPort }) {
  const starting = preview.status === EPreviewStatus.Starting

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
      <p className="text-sm text-foreground">
        {starting ? 'Waiting for port ' : 'Nothing is listening on port '}
        <span className="font-mono">{preview.port}</span>
      </p>
      <p className="text-xs text-muted-foreground">
        {starting
          ? 'The dev server is still booting.'
          : 'Start the server in a Terminal shell to expose it.'}
      </p>
    </div>
  )
}

interface BrowserFrameProps {
  preview: PreviewPort
  src?: string
  title: string
}

function BrowserFrame({ preview, src, title }: BrowserFrameProps) {
  const [reloadKey, setReloadKey] = useState(0)
  const live = preview.status === EPreviewStatus.Live

  const handleReload = () => setReloadKey((key) => key + 1)

  return (
    <div className="m-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Reload preview"
          disabled={!live}
          onClick={handleReload}
        >
          <RotateCwIcon />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-muted px-2 py-1">
          <LockIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-mono text-xs text-foreground">
            {src ?? preview.url}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Open in a new tab"
          nativeButton={false}
          render={<a href={src ?? preview.url} target="_blank" rel="noreferrer noopener" />}
        >
          <ExternalLinkIcon />
        </Button>
      </div>
      {live ? (
        <iframe
          key={`${preview.id}-${src ?? preview.url}-${reloadKey}`}
          src={src ?? preview.frameSrc ?? preview.url}
          title={title}
          className="min-h-0 w-full flex-1 bg-background"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      ) : (
        <OfflineNotice preview={preview} />
      )}
    </div>
  )
}

export function PreviewFrame({
  ports,
  selectedId,
  onSelect,
  src,
  title = 'Preview',
}: PreviewFrameProps) {
  const selected = selectedPortOf({ ports, selectedId })

  if (!selected) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 px-3 pt-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Exposed ports
      </p>
      <ul className="shrink-0 border-b border-border pb-1">
        {ports.map((preview) => (
          <PortRow
            key={preview.id}
            preview={preview}
            selected={preview.id === selected.id}
            onSelect={onSelect}
          />
        ))}
      </ul>
      <BrowserFrame preview={selected} src={src} title={title} />
    </div>
  )
}
