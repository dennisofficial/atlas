'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@dltech/atlas-ui/components/dialog'
import { Input } from '@dltech/atlas-ui/components/input'
import { Label } from '@dltech/atlas-ui/components/label'
import { Textarea } from '@dltech/atlas-ui/components/textarea'
import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'

import { ESecretKind } from '../fixtures/settings-library'

export type SecretEntry = { key: string; value: string; kind: ESecretKind }

const FORM_NOTE = 'Only you can see this. Project values override it.'

export function parseBulkLines(text: string): SecretEntry[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=')
      return {
        key: line.slice(0, index).trim(),
        value: line.slice(index + 1).trim(),
        kind: ESecretKind.EnvVar,
      }
    })
    .filter((entry) => entry.key.length > 0)
}

function SecretForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: SecretEntry | null
  onCancel: () => void
  onSubmit: (entry: SecretEntry) => void
}) {
  const editing = initial !== null
  const [key, setKey] = useState(initial?.key ?? '')
  const [value, setValue] = useState('')
  const [kind, setKind] = useState(initial?.kind ?? ESecretKind.Secret)

  const handleKindChange = (next: readonly unknown[]) => {
    const first = next[0]
    if (first === ESecretKind.Secret || first === ESecretKind.EnvVar) setKind(first)
  }

  const canSubmit = key.trim().length > 0 && (editing || value.length > 0)

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit value' : 'Add a value'}</DialogTitle>
        <DialogDescription>{FORM_NOTE}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="library-secret-key">Key</Label>
          <Input
            id="library-secret-key"
            className="font-mono text-xs"
            placeholder="DATABASE_URL"
            value={key}
            disabled={editing}
            onChange={(event) => setKey(event.target.value.toUpperCase())}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="library-secret-value">Value</Label>
          <Input
            id="library-secret-value"
            className="font-mono text-xs"
            type={kind === ESecretKind.Secret ? 'password' : 'text'}
            placeholder={editing ? 'Leave blank to keep the current value' : 'Value'}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Type</Label>
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            value={[kind]}
            onValueChange={handleKindChange}
          >
            <ToggleGroupItem value={ESecretKind.Secret}>Secret</ToggleGroupItem>
            <ToggleGroupItem value={ESecretKind.EnvVar}>Env var</ToggleGroupItem>
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            {kind === ESecretKind.Secret
              ? 'Secrets are encrypted and never shown again after saving.'
              : 'Env vars are plain values you can reveal later.'}
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canSubmit} onClick={() => onSubmit({ key, value, kind })}>
          {editing ? 'Save' : 'Add'}
        </Button>
      </DialogFooter>
    </>
  )
}

export function SecretDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: SecretEntry | null
  onSubmit: (entry: SecretEntry) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <SecretForm
          initial={initial}
          onCancel={() => onOpenChange(false)}
          onSubmit={(entry) => {
            onSubmit(entry)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function BulkForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void
  onSubmit: (entries: SecretEntry[]) => void
}) {
  const [text, setText] = useState('')
  const entries = parseBulkLines(text)

  return (
    <>
      <DialogHeader>
        <DialogTitle>Bulk add</DialogTitle>
        <DialogDescription>
          Paste one <span className="font-mono text-xs">KEY=value</span> per line, like a .env file.
          Lines are added as env vars.
        </DialogDescription>
      </DialogHeader>
      <Textarea
        className="min-h-40 font-mono text-xs"
        placeholder={'ATLAS_LOG_LEVEL=debug\nVERCEL_TEAM_ID=team_dltech'}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <DialogFooter>
        <span className="mr-auto self-center font-mono text-xs text-muted-foreground">
          {entries.length} {entries.length === 1 ? 'value' : 'values'}
        </span>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={entries.length === 0} onClick={() => onSubmit(entries)}>
          Add {entries.length > 0 ? entries.length : ''}
        </Button>
      </DialogFooter>
    </>
  )
}

export function BulkAddDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (entries: SecretEntry[]) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <BulkForm
          onCancel={() => onOpenChange(false)}
          onSubmit={(entries) => {
            onSubmit(entries)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
