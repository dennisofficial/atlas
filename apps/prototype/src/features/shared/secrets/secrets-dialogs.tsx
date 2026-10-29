import { useId, useState } from 'react'

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

import { ESecretsScope } from '../../settings/fixtures/settings-library'
import { parseEnvText, type SecretEntry } from './secrets-model'

const SCOPE_NOTES: Record<ESecretsScope, string> = {
  [ESecretsScope.Personal]: 'Personal value · applies to every project',
  [ESecretsScope.Project]:
    'Delivered to every thread in this project. It overrides a personal value with the same key.',
}

const EDIT_TITLES: Record<ESecretsScope, string> = {
  [ESecretsScope.Personal]: 'Edit personal value',
  [ESecretsScope.Project]: 'Edit value',
}

function SecretForm({
  scope,
  initial,
  onCancel,
  onSubmit,
}: {
  scope: ESecretsScope
  initial: SecretEntry | null
  onCancel: () => void
  onSubmit: (entry: SecretEntry) => void
}) {
  const keyId = useId()
  const valueId = useId()
  const editing = initial !== null
  const [key, setKey] = useState(initial?.key ?? '')
  const [value, setValue] = useState('')
  const canSubmit = key.trim().length > 0 && value.length > 0

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? EDIT_TITLES[scope] : 'Add a value'}</DialogTitle>
        <DialogDescription>{SCOPE_NOTES[scope]}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={keyId}>Key</Label>
          <Input
            id={keyId}
            className="font-mono text-xs"
            placeholder="DATABASE_URL"
            autoComplete="off"
            spellCheck={false}
            value={key}
            disabled={editing}
            onChange={(event) => setKey(event.target.value.toUpperCase())}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={valueId}>Value</Label>
          <Input
            id={valueId}
            className="font-mono text-xs"
            type="password"
            autoComplete="off"
            placeholder={editing ? 'New value' : 'Value'}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canSubmit} onClick={() => onSubmit({ key, value })}>
          {editing ? 'Save' : 'Add'}
        </Button>
      </DialogFooter>
    </>
  )
}

export function SecretDialog({
  open,
  onOpenChange,
  scope,
  initial,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: ESecretsScope
  initial: SecretEntry | null
  onSubmit: (entry: SecretEntry) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <SecretForm
          scope={scope}
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
  initialText,
  onCancel,
  onSubmit,
}: {
  initialText: string
  onCancel: () => void
  onSubmit: (entries: SecretEntry[]) => void
}) {
  const [text, setText] = useState(initialText)
  const entries = parseEnvText({ text })

  return (
    <>
      <DialogHeader>
        <DialogTitle>Bulk add</DialogTitle>
        <DialogDescription>
          Paste one <span className="font-mono text-xs">KEY=value</span> per line, like a .env file.
        </DialogDescription>
      </DialogHeader>
      <Textarea
        className="min-h-40 font-mono text-xs"
        spellCheck={false}
        aria-label=".env contents"
        placeholder={'ATLAS_LOG_LEVEL=debug\nNODE_ENV=development'}
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
  initialText,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialText: string
  onSubmit: (entries: SecretEntry[]) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <BulkForm
          initialText={initialText}
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
