'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'

import { SettingsCard, SettingsRow, SettingsSection } from '../settings-layout'
import { LibraryConfirmDialog } from './library-confirm-dialog'

export function WorkspaceDangerZone({
  name,
  isOwner,
  deleting,
  onDelete,
}: {
  name: string
  isOwner: boolean
  deleting: boolean
  onDelete: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const handleConfirm = () => {
    setConfirmOpen(false)
    onDelete()
  }
  return (
    <SettingsSection title="Danger zone">
      <SettingsCard tone="destructive">
        <SettingsRow
          title="Transfer ownership"
          description="Not available yet. Transferring a workspace isn't hooked up to Atlas Cloud."
          control={
            <Button variant="outline" size="sm" disabled>
              Transfer ownership
            </Button>
          }
        />
        <SettingsRow
          title="Delete workspace"
          description={
            isOwner
              ? `Permanently delete ${name}, its members, secrets and settings.`
              : 'Only the owner can delete this workspace.'
          }
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={!isOwner || deleting}
              onClick={() => setConfirmOpen(true)}
            >
              Delete workspace
            </Button>
          }
        />
      </SettingsCard>
      <LibraryConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete ${name}?`}
        description="This permanently deletes the workspace, its members, shared secrets and settings. It cannot be undone."
        confirmLabel="Delete workspace"
        onConfirm={handleConfirm}
      />
    </SettingsSection>
  )
}
