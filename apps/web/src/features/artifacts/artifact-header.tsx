'use client'

import { ExternalLinkIcon } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@dltech/atlas-ui/components/alert-dialog'
import { Button } from '@dltech/atlas-ui/components/button'
import type { ArtifactSummary } from '@dltech/atlas-wire/web'

import { ArtifactStatusChip } from './artifact-status-chip'
import { CopyButton } from './copy-button'

export function DeleteDialog({
  name,
  busy,
  onDelete,
}: {
  name: string
  busy: boolean
  onDelete: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button size="sm" variant="destructive" disabled={busy} />}>
        Delete
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The artifact, its source and its published build are deleted, and its URL stops serving.
            Files an agent kept in the thread are not touched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={onDelete}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function ArtifactHeader({
  artifact,
  busy,
  onDelete,
}: {
  artifact: ArtifactSummary
  busy: boolean
  onDelete: () => void
}) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="truncate text-xl font-medium tracking-tight">{artifact.name}</h1>
        <ArtifactStatusChip status={artifact.status} />
      </div>
      <p className="truncate font-mono text-xs text-muted-foreground">{artifact.url}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          nativeButton={false}
          render={<a href={artifact.url} target="_blank" rel="noreferrer" />}
        >
          <ExternalLinkIcon data-icon="inline-start" />
          Open
        </Button>
        <CopyButton value={artifact.url} label="Copy artifact URL" text="Copy URL" />
        <DeleteDialog name={artifact.name} busy={busy} onDelete={onDelete} />
      </div>
    </header>
  )
}
