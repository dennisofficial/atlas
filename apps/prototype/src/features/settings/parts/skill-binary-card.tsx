'use client'

import { DownloadIcon, FileIcon, Trash2Icon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

import { formatFileSize, type SkillFile } from '../fixtures/settings-skills'

export function SkillBinaryCard({
  file,
  onReplace,
  onDelete,
}: {
  file: SkillFile
  onReplace: () => void
  onDelete: () => void
}) {
  const handleDownload = () => {
    const url = URL.createObjectURL(new Blob([file.content]))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.path.split('/').at(-1) ?? file.path
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="flex min-h-0 flex-1 items-start justify-center rounded-md border bg-muted/20 p-8">
      <div className="flex w-72 flex-col items-center gap-3 rounded-lg border bg-card p-6 text-center">
        <span className="flex size-10 items-center justify-center rounded-md bg-muted ring-1 ring-foreground/10">
          <FileIcon className="size-5 text-muted-foreground" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="max-w-full truncate font-mono text-xs font-medium">{file.path}</span>
          <span className="text-xs text-muted-foreground">
            {formatFileSize(file)} · Binary files are stored, not edited.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <DownloadIcon data-icon="inline-start" />
            Download
          </Button>
          <Button variant="outline" size="sm" onClick={onReplace}>
            Replace
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete}>
            <Trash2Icon data-icon="inline-start" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}
