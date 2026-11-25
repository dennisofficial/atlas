'use client'

import { useState } from 'react'
import { LockKeyholeIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Card, CardRow } from '@dltech/atlas-ui/components/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'
import type { AccessGrant } from '@dltech/atlas-wire/web'

import type { TreeEntry } from '@/features/project-settings/data/file-mount-helpers'
import { runAction } from '@/features/settings/data/shared/run-action'

import { BulkAddDialog, AddSecretDialog, type SecretPair } from '../env-secrets-dialogs'
import { LibraryConfirmDialog } from '../library-confirm-dialog'
import { AccessFileDialog } from './access-file-dialog'
import { AccessGrantCard } from './access-grant-card'
import { AccessGrantDialog } from './access-grant-dialog'
import { deleteGrantDescription } from './access-grant-helpers'
import type { AccessGrantsActions } from './use-access-grants'

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

export function AccessGrantsContent({
  grants,
  now,
  personal,
  entries,
  secretDescription,
  actions,
}: {
  grants: readonly AccessGrant[]
  now: number
  personal: boolean
  entries: readonly TreeEntry[]
  secretDescription: string
  actions: AccessGrantsActions
}) {
  const [editing, setEditing] = useState<AccessGrant | null>(null)
  const [deleting, setDeleting] = useState<AccessGrant | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  const handleQuickAddSecret = (pair: SecretPair) => {
    void runAction({
      work: () => actions.setSecret({ name: pair.name, value: pair.value }),
      success: `Saved ${pair.name}`,
    })
  }
  const handleBulkAdd = (pairs: readonly SecretPair[]) => {
    void runAction({
      work: async () => {
        for (const pair of pairs) await actions.setSecret({ name: pair.name, value: pair.value })
      },
      success: `Saved ${pairs.length} ${pairs.length === 1 ? 'secret' : 'secrets'}`,
    })
  }
  const handleDelete = (grant: AccessGrant) => {
    setDeleting(null)
    void runAction({ work: () => actions.remove(grant.id), success: `Deleted ${grant.name}` })
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
            Group the secrets and files one job needs, then tell the agent what they unlock. Every
            session here reads the grants at the start of its next turn.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <AccessGrantDialog onSave={actions.save} />
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          Grants
          <span className="ml-2 font-mono text-xs text-muted-foreground">{grants.length}</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setBulkOpen(true)}>
            Bulk add
          </Button>
          <AddSecretDialog
            description={secretDescription}
            triggerLabel="Add secret"
            triggerVariant="outline"
            onAdd={handleQuickAddSecret}
          />
          <AccessFileDialog
            personal={personal}
            entries={entries}
            onSave={(draft) =>
              runAction({
                work: () => actions.setFile(draft),
                success: `Saved ${draft.path}`,
              })
            }
          />
          <AccessGrantDialog onSave={actions.save} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        A quick add makes a grant of one, named after the secret or the path.
      </p>
      <div className="flex flex-col gap-4">
        {grants.map((grant) => (
          <AccessGrantCard
            key={grant.id}
            grant={grant}
            grants={grants}
            now={now}
            personal={personal}
            entries={entries}
            secretDescription={secretDescription}
            actions={actions}
            onEditGrant={() => setEditing(grant)}
            onDeleteGrant={() => setDeleting(grant)}
          />
        ))}
      </div>
      {bulkOpen ? (
        <BulkAddDialog
          defaultOpen
          hideTrigger
          onAdd={(pairs) => {
            setBulkOpen(false)
            handleBulkAdd(pairs)
          }}
        />
      ) : null}
      {editing === null ? null : (
        <AccessGrantDialog
          key={editing.id}
          hideTrigger
          defaultOpen
          editing={editing}
          onClosed={() => setEditing(null)}
          onSave={actions.save}
        />
      )}
      <LibraryConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={`Delete ${deleting?.name ?? 'the grant'}?`}
        description={deleting === null ? '' : deleteGrantDescription(deleting)}
        confirmLabel="Delete grant"
        onConfirm={() => {
          if (deleting !== null) handleDelete(deleting)
        }}
      />
    </>
  )
}
