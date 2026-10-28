'use client'

import { useState } from 'react'
import { EllipsisIcon, EyeIcon, EyeOffIcon, KeyRoundIcon } from 'lucide-react'

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

import { ESecretKind } from '@dltech/atlas-wire/web'

import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { runAction } from '@/features/settings/data/shared/run-action'

import { useProjectContext } from './data/project-context'
import { projectSecretRows } from './data/project-secrets'
import { useProjectSecrets } from './data/use-project-secrets'
import type { SecretRow } from './fixtures/project-settings'
import { AddSecretDialog, BulkAddDialog, type SecretPair } from './secrets-dialogs'
import { SettingsSection } from './settings-layout'

const MASK = '••••••••••••'

function MaskedValue({ row }: { row: SecretRow }) {
  const [revealed, setRevealed] = useState(false)
  const Icon = revealed ? EyeOffIcon : EyeIcon
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate font-mono text-xs text-muted-foreground">
        {revealed ? row.value : MASK}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`${revealed ? 'Hide' : 'Reveal'} ${row.name}`}
        aria-pressed={revealed}
        onClick={() => setRevealed((current) => !current)}
      >
        <Icon />
      </Button>
    </span>
  )
}

function RowMenu({
  row,
  onDelete,
  onEdit,
}: {
  row: SecretRow
  onDelete: () => void
  onEdit: () => void
}) {
  const handleCopyName = () => {
    navigator.clipboard?.writeText(row.name).catch(() => undefined)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.name}`} />}
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onEdit}>Edit value</DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyName}>Copy name</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SecretsTable({
  rows,
  onDelete,
  onEdit,
}: {
  rows: readonly SecretRow[]
  onDelete: (name: string) => void
  onEdit: (name: string) => void
}) {
  return (
    <Table variant="framed" className="min-w-xl table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[36%]">Name</TableHead>
          <TableHead className="w-[36%]">Value</TableHead>
          <TableHead className="w-[20%]">Updated</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name}>
            <TableCell className="truncate font-mono text-xs font-medium">{row.name}</TableCell>
            <TableCell>
              <MaskedValue row={row} />
            </TableCell>
            <TableCell className="text-muted-foreground">{row.updated}</TableCell>
            <TableCell className="text-right">
              <RowMenu
                row={row}
                onDelete={() => onDelete(row.name)}
                onEdit={() => onEdit(row.name)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function SecretsEmpty() {
  return (
    <Empty variant="outline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyRoundIcon />
        </EmptyMedia>
        <EmptyTitle>No secrets or environment variables</EmptyTitle>
        <EmptyDescription>
          Add API keys and config the agent needs to build, test, and run this project. Paste a
          whole <span className="font-mono">.env</span> with Bulk add.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function SecretsContent({
  rows,
  onSave,
  onRemove,
}: {
  rows: readonly SecretRow[]
  onSave: (pairs: readonly SecretPair[]) => Promise<boolean>
  onRemove: (name: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const handleAdd = (pairs: readonly SecretPair[]) => void onSave(pairs)
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          Values
          {rows.length > 0 ? (
            <span className="ml-2 font-mono text-xs text-muted-foreground">{rows.length}</span>
          ) : null}
        </h3>
        <div className="flex items-center gap-2">
          <BulkAddDialog onAdd={handleAdd} />
          <AddSecretDialog onAdd={(pair) => handleAdd([pair])} />
        </div>
      </div>
      {rows.length === 0 ? (
        <SecretsEmpty />
      ) : (
        <SecretsTable rows={rows} onDelete={onRemove} onEdit={setEditing} />
      )}
      {editing === null ? null : (
        <AddSecretDialog
          key={editing}
          defaultOpen
          hideTrigger
          initialName={editing}
          onClosed={() => setEditing(null)}
          onAdd={(pair) => handleAdd([pair])}
        />
      )}
    </>
  )
}

export function SecretsPage() {
  const { projectId } = useProjectContext()
  const own = useProjectSecrets(projectId)

  const handleSave = (pairs: readonly SecretPair[]) =>
    runAction({
      work: async () => {
        for (const pair of pairs) {
          await own.save({ name: pair.name, value: pair.value, kind: ESecretKind.Secret })
        }
      },
      success:
        pairs.length === 1
          ? `Saved ${pairs[0]?.name ?? 'secret'}`
          : `Saved ${pairs.length} secrets`,
    })
  const handleRemove = (name: string) => {
    void runAction({ work: () => own.remove(name), success: `Deleted ${name}` })
  }

  return (
    <SettingsSection
      title="Secrets & Env Vars"
      description="Order of precedence: default, then personal, then project. The project value wins. Sessions don't load project values yet."
    >
      <QueryGate query={own.query} label="project secrets">
        {(snapshot) => {
          const rows = projectSecretRows({ secrets: snapshot.secrets, now: snapshot.fetchedAt })
          return <SecretsContent rows={rows} onSave={handleSave} onRemove={handleRemove} />
        }}
      </QueryGate>
    </SettingsSection>
  )
}
