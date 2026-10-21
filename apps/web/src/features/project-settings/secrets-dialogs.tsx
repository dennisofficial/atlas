'use client'

import { useState } from 'react'
import { PlusIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@dltech/atlas-ui/components/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'
import { Textarea } from '@dltech/atlas-ui/components/textarea'

const SECRET_NAME = /^[A-Z_][A-Z0-9_]*$/

export interface SecretPair {
  name: string
  value: string
}

export function parseEnvLines(text: string): { pairs: SecretPair[]; invalid: number[] } {
  const pairs: SecretPair[] = []
  const invalid: number[] = []
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) return
    const separator = line.indexOf('=')
    const name = separator === -1 ? '' : line.slice(0, separator).trim()
    if (!SECRET_NAME.test(name)) {
      invalid.push(index + 1)
      return
    }
    pairs.push({ name, value: line.slice(separator + 1) })
  })
  return { pairs, invalid }
}

export function AddSecretDialog({
  defaultOpen = false,
  initialName = '',
  hideTrigger = false,
  onClosed,
  onAdd,
}: {
  defaultOpen?: boolean
  initialName?: string
  hideTrigger?: boolean
  onClosed?: () => void
  onAdd: (pair: SecretPair) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [name, setName] = useState(initialName)
  const [value, setValue] = useState('')
  const nameInvalid = name !== '' && !SECRET_NAME.test(name)
  const canSave = SECRET_NAME.test(name) && value !== ''

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) return
    setName('')
    setValue('')
    onClosed?.()
  }
  const handleSubmit = () => {
    if (!canSave) return
    onAdd({ name, value })
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {hideTrigger ? null : (
        <DialogTrigger render={<Button size="sm" />}>
          <PlusIcon data-icon="inline-start" />
          Add
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a secret</DialogTitle>
          <DialogDescription>
            Available to every thread in this project as an environment variable.
          </DialogDescription>
        </DialogHeader>
        <Field data-invalid={nameInvalid || undefined}>
          <FieldLabel htmlFor="secret-name">Name</FieldLabel>
          <Input
            id="secret-name"
            className="font-mono"
            placeholder="STRIPE_SECRET_KEY"
            autoComplete="off"
            aria-invalid={nameInvalid || undefined}
            value={name}
            onChange={(event) => setName(event.target.value.toUpperCase())}
          />
          {nameInvalid ? (
            <FieldError>Letters, digits, and underscores; not starting with a digit.</FieldError>
          ) : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="secret-value">Value</FieldLabel>
          <Textarea
            id="secret-value"
            className="min-h-20 font-mono text-xs md:text-xs"
            spellCheck={false}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <FieldDescription>
            Encrypted at rest. Nobody can read it back after saving.
          </FieldDescription>
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled={!canSave} onClick={handleSubmit}>
            Add secret
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BulkAddDialog({
  defaultOpen = false,
  initialText = '',
  onAdd,
}: {
  defaultOpen?: boolean
  initialText?: string
  onAdd: (pairs: SecretPair[]) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [text, setText] = useState(initialText)
  const { pairs, invalid } = parseEnvLines(text)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setText('')
  }
  const handleSubmit = () => {
    onAdd(pairs)
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Bulk add</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk add secrets</DialogTitle>
          <DialogDescription>
            Paste a <span className="font-mono">.env</span> file. Existing names are overwritten.
          </DialogDescription>
        </DialogHeader>
        <Field data-invalid={invalid.length > 0 || undefined}>
          <FieldLabel htmlFor="bulk-secrets">One KEY=value per line</FieldLabel>
          <Textarea
            id="bulk-secrets"
            className="min-h-40 font-mono text-xs md:text-xs"
            spellCheck={false}
            placeholder={'API_KEY=…\nDATABASE_URL=…'}
            aria-invalid={invalid.length > 0 || undefined}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {invalid.length > 0 ? (
            <FieldError>
              {invalid.length === 1 ? 'Line' : 'Lines'} {invalid.join(', ')} skipped: not KEY=value.
            </FieldError>
          ) : (
            <FieldDescription>Blank lines and # comments are ignored.</FieldDescription>
          )}
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled={pairs.length === 0} onClick={handleSubmit}>
            {pairs.length === 0
              ? 'Add secrets'
              : `Add ${pairs.length} ${pairs.length === 1 ? 'secret' : 'secrets'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
