import { useState, type ReactNode } from 'react'
import { ArrowUpRightIcon, KeyRoundIcon, PlusIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'

import { ESecretsScope, type LibrarySecret } from '../../../fixtures/settings-library'
import { LibraryConfirmDialog } from '../../settings/parts/library-confirm-dialog'
import { SettingsCard, SettingsPage, SettingsSection } from '../../settings/settings-layout'
import { BulkAddDialog, SecretDialog } from './secrets-dialogs'
import {
  overriddenKeys,
  partitionByScope,
  splitByKind,
  updateEntry,
  upsertEntries,
  type SecretEntry,
} from './secrets-model'
import { SecretRow } from './secrets-row'

export enum ESecretsDialog {
  None = 'none',
  Add = 'add',
  BulkAdd = 'bulk-add',
}

function SecretsEmpty() {
  return (
    <Empty className="border py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyRoundIcon />
        </EmptyMedia>
        <EmptyTitle>No secrets or environment variables</EmptyTitle>
        <EmptyDescription>
          Add API keys and config for your sandboxes. Paste a whole{' '}
          <span className="font-mono">.env</span> with Bulk add.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function InheritedLabel() {
  return (
    <div className="bg-muted/30 px-4 py-1.5 text-xs font-medium text-muted-foreground">
      Personal
    </div>
  )
}

function GroupEmpty({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
      {label}
    </div>
  )
}

export function SecretsView({
  scope,
  initialRows,
  description,
  openDialog = ESecretsDialog.None,
  bulkText = '',
  onOpenPersonal,
}: {
  scope: ESecretsScope
  initialRows: readonly LibrarySecret[]
  description: ReactNode
  openDialog?: ESecretsDialog
  bulkText?: string
  onOpenPersonal?: () => void
}) {
  const [rows, setRows] = useState<readonly LibrarySecret[]>(initialRows)
  const [addOpen, setAddOpen] = useState(openDialog === ESecretsDialog.Add)
  const [bulkOpen, setBulkOpen] = useState(openDialog === ESecretsDialog.BulkAdd)
  const [editing, setEditing] = useState<LibrarySecret | null>(null)
  const [deleting, setDeleting] = useState<LibrarySecret | null>(null)

  const overridden = overriddenKeys(rows)
  const { envVars, secrets } = splitByKind(rows)

  const handleAdd = (entries: SecretEntry[]) =>
    setRows((current) => upsertEntries({ rows: current, entries, scope }))

  const handleEdit = (entry: SecretEntry) =>
    setRows((current) => updateEntry({ rows: current, entry, scope: editing?.scope ?? scope }))

  const handleDelete = () => {
    setRows((current) => current.filter((row) => row.id !== deleting?.id))
    setDeleting(null)
  }

  const renderRow = (secret: LibrarySecret) => (
    <SecretRow
      key={secret.id}
      secret={secret}
      overridesPersonal={secret.scope === ESecretsScope.Project && overridden.has(secret.key)}
      shadowed={secret.scope === ESecretsScope.Personal && overridden.has(secret.key)}
      onEdit={() => setEditing(secret)}
      onDelete={() => setDeleting(secret)}
    />
  )

  const renderGroup = ({ items, emptyLabel }: { items: LibrarySecret[]; emptyLabel: string }) => {
    if (items.length === 0) return <GroupEmpty label={emptyLabel} />
    const { own, inherited } = partitionByScope({ rows: items, scope })
    return (
      <SettingsCard>
        {own.map(renderRow)}
        {inherited.length > 0 ? <InheritedLabel /> : null}
        {inherited.map(renderRow)}
      </SettingsCard>
    )
  }

  return (
    <SettingsPage
      title="Secrets & Env Vars"
      description={description}
      actions={
        <>
          {scope === ESecretsScope.Project ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => onOpenPersonal?.()}
            >
              Personal secrets
              <ArrowUpRightIcon data-icon="inline-end" />
            </Button>
          ) : null}
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
      {rows.length === 0 ? (
        <SecretsEmpty />
      ) : (
        <>
          <SettingsSection title="Environment variables" count={envVars.length}>
            {renderGroup({ items: envVars, emptyLabel: 'No environment variables.' })}
          </SettingsSection>
          <SettingsSection title="Secrets" count={secrets.length}>
            {renderGroup({ items: secrets, emptyLabel: 'No secrets.' })}
          </SettingsSection>
        </>
      )}

      <SecretDialog
        key={`add-${addOpen}`}
        open={addOpen}
        onOpenChange={setAddOpen}
        scope={scope}
        initial={null}
        onSubmit={(entry) => handleAdd([entry])}
      />
      <SecretDialog
        key={`edit-${editing?.id ?? 'none'}`}
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        scope={editing?.scope ?? scope}
        initial={editing}
        onSubmit={handleEdit}
      />
      <BulkAddDialog
        key={`bulk-${bulkOpen}`}
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        initialText={bulkText}
        onSubmit={handleAdd}
      />
      <LibraryConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title={`Delete ${deleting?.key ?? 'value'}?`}
        description="New sandboxes stop receiving it. Running sandboxes keep it until they restart."
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </SettingsPage>
  )
}
