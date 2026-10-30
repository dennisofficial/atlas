'use client'

import { useState } from 'react'
import { EllipsisIcon, KeyRoundIcon } from 'lucide-react'

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

import { AddSecretDialog, BulkAddDialog, type SecretPair } from './env-secrets-dialogs'
import { SecretValueCell } from './secret-value-cell'

export interface EnvSecretRow {
  name: string
  updated: string
}

function RowMenu({
  name,
  onDelete,
  onEdit,
}: {
  name: string
  onDelete: () => void
  onEdit: () => void
}) {
  const handleCopyName = () => {
    navigator.clipboard?.writeText(name).catch(() => undefined)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`} />}
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
  fetchValue,
  onDelete,
  onEdit,
}: {
  rows: readonly EnvSecretRow[]
  fetchValue: (name: string) => Promise<string>
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
              <SecretValueCell name={row.name} fetchValue={() => fetchValue(row.name)} />
            </TableCell>
            <TableCell className="text-muted-foreground">{row.updated}</TableCell>
            <TableCell className="text-right">
              <RowMenu
                name={row.name}
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

function SecretsEmpty({ description }: { description: string }) {
  return (
    <Empty variant="outline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyRoundIcon />
        </EmptyMedia>
        <EmptyTitle>No secrets or environment variables</EmptyTitle>
        <EmptyDescription>
          {description} Paste a whole <span className="font-mono">.env</span> with Bulk add.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function EnvSecretsContent({
  rows,
  emptyDescription,
  dialogDescription,
  fetchValue,
  onSave,
  onRemove,
}: {
  rows: readonly EnvSecretRow[]
  emptyDescription: string
  dialogDescription: string
  fetchValue: (name: string) => Promise<string>
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
          <AddSecretDialog description={dialogDescription} onAdd={(pair) => handleAdd([pair])} />
        </div>
      </div>
      {rows.length === 0 ? (
        <SecretsEmpty description={emptyDescription} />
      ) : (
        <SecretsTable rows={rows} fetchValue={fetchValue} onDelete={onRemove} onEdit={setEditing} />
      )}
      {editing === null ? null : (
        <AddSecretDialog
          key={editing}
          defaultOpen
          hideTrigger
          description={dialogDescription}
          initialName={editing}
          onClosed={() => setEditing(null)}
          onAdd={(pair) => handleAdd([pair])}
        />
      )}
    </>
  )
}
