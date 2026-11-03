'use client'

import { DownloadIcon, FileIcon, Trash2Icon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

import { formatBytes } from './skill-format'

export function SkillBinaryCard({
  path,
  sizeBytes,
  readOnly = false,
  onDownload,
  onReplace,
  onDelete,
}: {
  path: string
  sizeBytes: number
  readOnly?: boolean
  onDownload: () => void
  onReplace: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 items-start justify-center rounded-md border bg-muted/20 p-8">
      <div className="flex w-72 flex-col items-center gap-3 rounded-lg border bg-card p-6 text-center">
        <span className="flex size-10 items-center justify-center rounded-md bg-muted ring-1 ring-foreground/10">
          <FileIcon className="size-5 text-muted-foreground" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="max-w-full truncate font-mono text-xs font-medium">{path}</span>
          <span className="text-xs text-muted-foreground">
            {formatBytes(sizeBytes)} · Binary files are stored, not edited.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onDownload}>
            <DownloadIcon data-icon="inline-start" />
            Download
          </Button>
          {readOnly ? null : (
            <>
              <Button variant="outline" size="sm" onClick={onReplace}>
                Replace
              </Button>
              <Button variant="outline" size="sm" onClick={onDelete}>
                <Trash2Icon data-icon="inline-start" />
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
