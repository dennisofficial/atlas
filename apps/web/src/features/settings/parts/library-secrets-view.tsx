'use client'

import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { KeyRoundIcon, PlusIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'

import type { LibrarySecret } from '../fixtures/settings-library'
import { SettingsCard, SettingsPage, SettingsSection } from '../settings-layout'
import { LibraryConfirmDialog } from './library-confirm-dialog'
import { BulkAddDialog, SecretDialog, type SecretEntry } from './library-secret-dialogs'
import { SecretRow } from './library-secret-row'
import type { SecretsStore } from './secrets-store'

export function SecretsView({
  description,
  sectionDescription,
  store,
}: {
  description: ReactNode
  sectionDescription: string
  store: SecretsStore
}) {
  const { secrets } = store
  const [addOpen, setAddOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [editing, setEditing] = useState<LibrarySecret | null>(null)
  const [deleting, setDeleting] = useState<LibrarySecret | null>(null)

  const run = async (work: () => Promise<void>) => {
    try {
      await work()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the change')
    }
  }

  const handleAdd = (entry: SecretEntry) => {
    setAddOpen(false)
    void run(() => store.save(entry))
  }

  const handleBulkAdd = (entries: SecretEntry[]) => {
    setBulkOpen(false)
    void run(async () => {
      for (const entry of entries) await store.save(entry)
    })
  }

  const handleEdit = (entry: SecretEntry) => {
    setEditing(null)
    void run(() => store.save(entry))
  }

  const handleDelete = () => {
    const target = deleting
    setDeleting(null)
    if (target !== null) void run(() => store.remove(target.key))
  }

  return (
    <SettingsPage title="Secrets & Env Vars" description={description}>
      <SettingsSection
        title="Values"
        description={sectionDescription}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
              Bulk add
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <PlusIcon />
              Add
            </Button>
          </>
        }
      >
        {secrets.length === 0 ? (
          <Empty variant="outline">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyRoundIcon />
              </EmptyMedia>
              <EmptyTitle>No secrets or environment variables yet.</EmptyTitle>
              <EmptyDescription>
                Add a value and it is injected into your sandboxes.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <SettingsCard>
            {secrets.map((secret) => (
              <SecretRow
                key={secret.id}
                secret={secret}
                onEdit={() => setEditing(secret)}
                onDelete={() => setDeleting(secret)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSection>

      <SecretDialog
        key={`add-${addOpen}`}
        open={addOpen}
        onOpenChange={setAddOpen}
        initial={null}
        onSubmit={handleAdd}
      />
      <SecretDialog
        key={`edit-${editing?.id ?? 'none'}`}
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        initial={editing}
        onSubmit={handleEdit}
      />
      <BulkAddDialog
        key={`bulk-${bulkOpen}`}
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onSubmit={handleBulkAdd}
      />
      <LibraryConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title={`Delete ${deleting?.key ?? 'value'}?`}
        description="Your threads stop receiving it on their next sandbox start."
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </SettingsPage>
  )
}
