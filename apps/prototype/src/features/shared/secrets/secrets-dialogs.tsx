import { useId, useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Checkbox } from '@dltech/atlas-ui/components/checkbox'
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

import { ESecretKind, ESecretsScope } from '../../settings/fixtures/settings-library'
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

const KIND_NOTES: Record<ESecretKind, string> = {
  [ESecretKind.Secret]: 'Secrets are encrypted and hidden in the list until you reveal them.',
  [ESecretKind.EnvVar]: 'Env vars are plain values, shown in the list.',
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
  const [value, setValue] = useState(initial?.kind === ESecretKind.EnvVar ? initial.value : '')
  const [kind, setKind] = useState(initial?.kind ?? ESecretKind.Secret)
  const isSecret = kind === ESecretKind.Secret

  const handleKindChange = (next: readonly unknown[]) => {
    const first = next[0]
    if (first === ESecretKind.Secret || first === ESecretKind.EnvVar) setKind(first)
  }

  const canSubmit = key.trim().length > 0 && (value.length > 0 || (editing && isSecret))

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? EDIT_TITLES[scope] : 'Add a value'}</DialogTitle>
        <DialogDescription>{SCOPE_NOTES[scope]}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Type</Label>
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            value={[kind]}
            onValueChange={handleKindChange}
            aria-label="Type"
          >
            <ToggleGroupItem value={ESecretKind.EnvVar}>Env var</ToggleGroupItem>
            <ToggleGroupItem value={ESecretKind.Secret}>Secret</ToggleGroupItem>
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">{KIND_NOTES[kind]}</p>
        </div>
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
          {isSecret ? (
            <Input
              id={valueId}
              className="font-mono text-xs"
              type="password"
              autoComplete="off"
              placeholder={editing ? 'Leave blank to keep the current value' : 'Value'}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          ) : (
            <Textarea
              id={valueId}
              className="min-h-20 font-mono text-xs"
              spellCheck={false}
              placeholder="Value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
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
  const secretsId = useId()
  const [text, setText] = useState(initialText)
  const [asSecrets, setAsSecrets] = useState(false)
  const entries = parseEnvText({
    text,
    kind: asSecrets ? ESecretKind.Secret : ESecretKind.EnvVar,
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle>Bulk add</DialogTitle>
        <DialogDescription>
          Paste one <span className="font-mono text-xs">KEY=value</span> per line, like a .env file.
          Lines are added as env vars unless you mark them as secrets.
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
      <div className="flex items-center gap-2">
        <Checkbox id={secretsId} checked={asSecrets} onCheckedChange={setAsSecrets} />
        <Label htmlFor={secretsId}>Add all as secrets</Label>
      </div>
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
