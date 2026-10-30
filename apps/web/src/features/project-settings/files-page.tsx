'use client'

import { useState } from 'react'
import { EllipsisIcon, FileKeyIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'
import { DEFAULT_FILE_MOUNT_MODE, REAUTH_REQUIRED_CODE } from '@dltech/atlas-wire/web'

import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { relativeTimeOf } from '@/features/settings/data/shared/relative-time'
import { runAction } from '@/features/settings/data/shared/run-action'
import { ReauthDialog } from '@/features/settings/parts/reauth-dialog'
import { CloudApiError } from '@/lib/cloud-api'
import { EQueryState } from '@/lib/use-cloud-query'

import { useProjectContext } from './data/project-context'
import { revealFileMount, type ListedFileMount } from './data/file-mounts-api'
import { formatFileMode, type TreeEntry } from './data/file-mount-helpers'
import { useProjectFileMounts, useRepoTreeEntries } from './data/use-project-file-mounts'
import { FileMountDialog, type EditingFile, type FileDraft } from './files-dialogs'
import { SettingsSection } from './settings-layout'

const DESCRIPTION =
  'Atlas writes these files into every sandbox of this project when the sandbox starts. A change you make here reaches the next sandbox that starts. Changes a tool makes to a file during a session are lost on the next start.'

function RowMenu({
  path,
  busy,
  onEdit,
  onDelete,
}: {
  path: string
  busy: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${path}`} />}
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem disabled={busy} onClick={onEdit}>
          Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FilesTable({
  mounts,
  now,
  revealing,
  onEdit,
  onDelete,
}: {
  mounts: readonly ListedFileMount[]
  now: number
  revealing: boolean
  onEdit: (path: string) => void
  onDelete: (path: string) => void
}) {
  return (
    <Table variant="framed" className="min-w-xl table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[52%]">Path</TableHead>
          <TableHead className="w-[16%]">Mode</TableHead>
          <TableHead className="w-[24%]">Updated</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {mounts.map((mount) => (
          <TableRow key={mount.path}>
            <TableCell className="truncate font-mono text-xs font-medium">{mount.path}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {formatFileMode(mount.mode)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {relativeTimeOf({ iso: mount.updatedAt, now })}
            </TableCell>
            <TableCell className="text-right">
              <RowMenu
                path={mount.path}
                busy={revealing}
                onEdit={() => onEdit(mount.path)}
                onDelete={() => onDelete(mount.path)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function FilesEmpty({
  entries,
  onSave,
}: {
  entries: readonly TreeEntry[]
  onSave: (draft: FileDraft) => Promise<boolean>
}) {
  return (
    <Empty variant="outline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileKeyIcon />
        </EmptyMedia>
        <EmptyTitle>No files yet</EmptyTitle>
        <EmptyDescription>
          Add the config files a sandbox needs, like a <span className="font-mono">.env.local</span>{' '}
          or a certificate. Atlas writes each one at start, before the first turn.
        </EmptyDescription>
      </EmptyHeader>
      <FileMountDialog entries={entries} onSave={onSave} />
    </Empty>
  )
}

export function FilesPage() {
  const { projectId } = useProjectContext()
  const own = useProjectFileMounts(projectId)
  const tree = useRepoTreeEntries(projectId)
  const entries = tree.state === EQueryState.Ready ? tree.data : []
  const [editing, setEditing] = useState<EditingFile | null>(null)
  const [reauthPath, setReauthPath] = useState<string | null>(null)
  const [revealing, setRevealing] = useState(false)
  const mounts = own.query.data?.mounts ?? []

  const handleSave = (draft: FileDraft) =>
    runAction({
      work: () => own.save(draft),
      success: `Saved ${draft.path}`,
    })
  const handleRemove = (path: string) => {
    void runAction({
      work: () => own.remove(path),
      success: `Deleted ${path}`,
    })
  }
  const handleEdit = async (path: string) => {
    if (revealing) return
    setRevealing(true)
    try {
      const contents = await revealFileMount({ projectId, path })
      const mount = mounts.find((candidate) => candidate.path === path)
      setEditing({
        path,
        contents,
        modeText: formatFileMode(mount?.mode ?? DEFAULT_FILE_MOUNT_MODE),
      })
    } catch (failure) {
      if (failure instanceof CloudApiError && failure.code === REAUTH_REQUIRED_CODE) {
        setReauthPath(path)
      } else {
        toast.error('Could not open the file')
      }
    } finally {
      setRevealing(false)
    }
  }

  const handleReauthOpenChange = (open: boolean) => {
    if (!open) setReauthPath(null)
  }
  const handleReauthConfirmed = () => {
    const path = reauthPath
    setReauthPath(null)
    if (path !== null) void handleEdit(path)
  }

  return (
    <SettingsSection title="Files" description={DESCRIPTION}>
      <QueryGate query={own.query} label="project files">
        {(snapshot) => (
          <>
            {snapshot.mounts.length === 0 ? null : (
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">
                  Mounted files
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {snapshot.mounts.length}
                  </span>
                </h3>
                <FileMountDialog entries={entries} onSave={handleSave} />
              </div>
            )}
            {snapshot.mounts.length === 0 ? (
              <FilesEmpty entries={entries} onSave={handleSave} />
            ) : (
              <FilesTable
                revealing={revealing}
                mounts={snapshot.mounts}
                now={snapshot.fetchedAt}
                onEdit={(path) => void handleEdit(path)}
                onDelete={handleRemove}
              />
            )}
          </>
        )}
      </QueryGate>
      {editing === null ? null : (
        <FileMountDialog
          key={editing.path}
          entries={entries}
          editing={editing}
          onClosed={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
      <ReauthDialog
        open={reauthPath !== null}
        onOpenChange={handleReauthOpenChange}
        onConfirmed={handleReauthConfirmed}
      />
    </SettingsSection>
  )
}
