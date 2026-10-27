import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'

import { SettingsCard, SettingsRow, SettingsSection } from '../settings-layout'
import { LibraryConfirmDialog } from './library-confirm-dialog'

export function WorkspaceDangerZone({ name }: { name: string }) {
  const [transferOpen, setTransferOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  return (
    <SettingsSection title="Danger zone">
      <SettingsCard className="border-destructive/30">
        <SettingsRow
          title="Transfer ownership"
          description="Hand this workspace to another admin. You become an admin."
          control={
            <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)}>
              Transfer ownership
            </Button>
          }
        />
        <SettingsRow
          title="Delete workspace"
          description={`Permanently delete ${name}, its members, secrets and settings.`}
          control={
            <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
              Delete workspace
            </Button>
          }
        />
      </SettingsCard>
      <LibraryConfirmDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        title={`Transfer ${name}?`}
        description="The new owner controls billing, members and deletion. You keep admin access."
        confirmLabel="Transfer"
        onConfirm={() => setTransferOpen(false)}
      />
      <LibraryConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${name}?`}
        description="This permanently deletes the workspace, its members, shared secrets and settings. It cannot be undone."
        confirmLabel="Delete workspace"
        onConfirm={() => setDeleteOpen(false)}
      />
    </SettingsSection>
  )
}
