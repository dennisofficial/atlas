import { useState } from 'react'
import { ExternalLinkIcon, LockIcon, RotateCwIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { StatusDot } from './status-dot'
import { EDotTone } from './session-types'
import { EPreviewStatus, PREVIEW_URLS, type PreviewUrl } from './session-previews'

export interface PreviewTabProps {
  initialPreviewId?: string
}

const STATUS_TONE: Record<EPreviewStatus, EDotTone> = {
  [EPreviewStatus.Live]: EDotTone.Live,
  [EPreviewStatus.Starting]: EDotTone.Pending,
  [EPreviewStatus.Stopped]: EDotTone.Idle,
}

const STATUS_LABEL: Record<EPreviewStatus, string> = {
  [EPreviewStatus.Live]: 'Live',
  [EPreviewStatus.Starting]: 'Starting',
  [EPreviewStatus.Stopped]: 'Stopped',
}

interface UrlRowProps {
  preview: PreviewUrl
  selected: boolean
  onSelect: (id: string) => void
}

function UrlRow({ preview, selected, onSelect }: UrlRowProps) {
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
          {STATUS_LABEL[preview.status]}
        </span>
        <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
          :{preview.port}
        </span>
      </button>
    </li>
  )
}

function PlaceholderPage({ preview }: { preview: PreviewUrl }) {
  if (preview.status !== EPreviewStatus.Live) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm text-foreground">
          {preview.status === EPreviewStatus.Starting
            ? 'Waiting for port '
            : 'Nothing is listening on port '}
          <span className="font-mono">{preview.port}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {preview.status === EPreviewStatus.Starting
            ? 'The dev server is still booting.'
            : 'Start the server in a Terminal shell to expose it.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-3 bg-muted/30 p-4">
      <div className="h-3 w-24 rounded bg-muted" />
      <div className="h-6 w-2/3 rounded bg-muted" />
      <div className="h-3 w-1/2 rounded bg-muted" />
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div className="h-20 rounded-md bg-muted" />
        <div className="h-20 rounded-md bg-muted" />
        <div className="h-20 rounded-md bg-muted" />
      </div>
      <div className="h-3 w-full rounded bg-muted" />
      <div className="h-3 w-5/6 rounded bg-muted" />
    </div>
  )
}

function BrowserFrame({ preview }: { preview: PreviewUrl }) {
  return (
    <div className="m-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <Button variant="ghost" size="icon-xs" aria-label="Reload preview">
          <RotateCwIcon />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-muted px-2 py-1">
          <LockIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-mono text-xs text-foreground">{preview.url}</span>
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Open in a new tab">
          <ExternalLinkIcon />
        </Button>
      </div>
      <PlaceholderPage preview={preview} />
    </div>
  )
}

export function PreviewTab({ initialPreviewId = PREVIEW_URLS[0]?.id }: PreviewTabProps) {
  const [selectedId, setSelectedId] = useState(initialPreviewId ?? '')
  const selected = PREVIEW_URLS.find((preview) => preview.id === selectedId) ?? PREVIEW_URLS[0]

  if (!selected) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 px-3 pt-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Exposed ports
      </p>
      <ul className="shrink-0 border-b border-border pb-1">
        {PREVIEW_URLS.map((preview) => (
          <UrlRow
            key={preview.id}
            preview={preview}
            selected={preview.id === selected.id}
            onSelect={setSelectedId}
          />
        ))}
      </ul>
      <BrowserFrame preview={selected} />
    </div>
  )
}
