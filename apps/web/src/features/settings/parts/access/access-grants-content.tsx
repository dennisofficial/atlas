'use client'

import { useState } from 'react'
import { FileKeyIcon, KeyRoundIcon, LockKeyholeIcon } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dltech/atlas-ui/components/alert-dialog'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { Card, CardRow } from '@dltech/atlas-ui/components/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'
import type { AccessGrant } from '@dltech/atlas-wire/web'

import { runAction } from '../../data/shared/run-action'
import { LibraryRowMenu } from '../library-row-menu'
import { AccessGrantDialog } from './access-grant-dialog'
import type { AccessGrantDraft } from './use-access-grants'

const SKELETON_KEYS = ['a', 'b', 'c']

export function AccessGrantsSkeleton() {
  return (
    <Card variant="list">
      {SKELETON_KEYS.map((key) => (
        <CardRow key={key}>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full max-w-md" />
            <div className="flex gap-1.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        </CardRow>
      ))}
    </Card>
  )
}

function GrantMembers({ grant }: { grant: AccessGrant }) {
  if (grant.secretNames.length === 0 && grant.filePaths.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No members: the instruction stands alone.</p>
    )
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {grant.secretNames.map((name) => (
        <Badge key={`secret:${name}`} variant="secondary" className="font-mono">
          <KeyRoundIcon data-icon="inline-start" />
          {name}
        </Badge>
      ))}
      {grant.filePaths.map((path) => (
        <Badge key={`file:${path}`} variant="outline" className="font-mono">
          <FileKeyIcon data-icon="inline-start" />
          {path}
        </Badge>
      ))}
    </div>
  )
}

function GrantRow({
  grant,
  onEdit,
  onDelete,
}: {
  grant: AccessGrant
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <CardRow>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-medium">{grant.name}</h3>
          {grant.instruction === '' ? (
            <p className="text-sm text-muted-foreground">No instruction</p>
          ) : (
            <p className="line-clamp-2 max-w-prose text-sm text-muted-foreground">
              {grant.instruction}
            </p>
          )}
          <GrantMembers grant={grant} />
        </div>
        <LibraryRowMenu
          label={grant.name}
          actions={[
            { label: 'Edit', onSelect: onEdit },
            { label: 'Delete', onSelect: onDelete, destructive: true },
          ]}
        />
      </div>
    </CardRow>
  )
}

export function AccessGrantsContent({
  grants,
  secretNames,
  filePaths,
  onSave,
  onRemove,
}: {
  grants: readonly AccessGrant[]
  secretNames: readonly string[]
  filePaths?: readonly string[]
  onSave: (draft: AccessGrantDraft) => Promise<void>
  onRemove: (id: string) => Promise<void>
}) {
  const [editing, setEditing] = useState<AccessGrant | null>(null)
  const [deleting, setDeleting] = useState<AccessGrant | null>(null)

  const handleDelete = (grant: AccessGrant) => {
    setDeleting(null)
    void runAction({
      work: () => onRemove(grant.id),
      success: `Deleted ${grant.name}`,
    })
  }

  if (grants.length === 0) {
    return (
      <Empty variant="outline">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LockKeyholeIcon />
          </EmptyMedia>
          <EmptyTitle>No access grants yet</EmptyTitle>
          <EmptyDescription>
            Group a secret or a mounted file with a note that tells the agent what it unlocks. Every
            session here reads the grants at the start of its next turn.
          </EmptyDescription>
        </EmptyHeader>
        <AccessGrantDialog
          grants={grants}
          secretNames={secretNames}
          filePaths={filePaths}
          onSave={onSave}
        />
      </Empty>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          Grants
          <span className="ml-2 font-mono text-xs text-muted-foreground">{grants.length}</span>
        </h3>
        <AccessGrantDialog
          grants={grants}
          secretNames={secretNames}
          filePaths={filePaths}
          onSave={onSave}
        />
      </div>
      <Card variant="list">
        {grants.map((grant) => (
          <GrantRow
            key={grant.id}
            grant={grant}
            onEdit={() => setEditing(grant)}
            onDelete={() => setDeleting(grant)}
          />
        ))}
      </Card>
      {editing === null ? null : (
        <AccessGrantDialog
          key={editing.id}
          hideTrigger
          editing={editing}
          grants={grants}
          secretNames={secretNames}
          filePaths={filePaths}
          onClosed={() => setEditing(null)}
          onSave={onSave}
        />
      )}
      <AccessGrantDeleteDialog
        grant={deleting}
        onClosed={() => setDeleting(null)}
        onConfirm={handleDelete}
      />
    </>
  )
}

export function AccessGrantDeleteDialog({
  grant,
  onClosed,
  onConfirm,
}: {
  grant: AccessGrant | null
  onClosed: () => void
  onConfirm: (grant: AccessGrant) => void
}) {
  const handleOpenChange = (open: boolean) => {
    if (!open) onClosed()
  }
  return (
    <AlertDialog open={grant !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {grant?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its secrets and files stay. They are no longer grouped.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (grant !== null) onConfirm(grant)
            }}
          >
            Delete grant
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
