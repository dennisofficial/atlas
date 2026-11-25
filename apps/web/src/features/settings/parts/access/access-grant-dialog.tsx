'use client'

import { useId, useState } from 'react'
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
import {
  ACCESS_GRANT_INSTRUCTION_MAX,
  ACCESS_GRANT_NAME_MAX,
  type AccessGrant,
} from '@dltech/atlas-wire/web'

import type { AccessGrantDraft } from './use-access-grants'

export function AccessGrantDialog({
  editing,
  defaultOpen = false,
  hideTrigger = false,
  onClosed,
  onSave,
}: {
  editing?: AccessGrant
  defaultOpen?: boolean
  hideTrigger?: boolean
  onClosed?: () => void
  onSave: (draft: AccessGrantDraft) => Promise<void>
}) {
  const fieldId = useId()
  const [open, setOpen] = useState(defaultOpen || editing !== undefined)
  const [name, setName] = useState(editing?.name ?? '')
  const [instruction, setInstruction] = useState(editing?.instruction ?? '')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const canSave = name.trim() !== '' && !saving

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) return
    setName('')
    setInstruction('')
    setFailure(null)
    onClosed?.()
  }
  const handleSubmit = async () => {
    if (!canSave) return
    setSaving(true)
    setFailure(null)
    try {
      await onSave({
        ...(editing === undefined ? {} : { id: editing.id }),
        name: name.trim(),
        instruction,
      })
      handleOpenChange(false)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not save the grant')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {hideTrigger ? null : (
        <DialogTrigger render={<Button size="sm" />}>
          <PlusIcon data-icon="inline-start" />
          New grant
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing === undefined ? 'New access grant' : 'Edit access grant'}
          </DialogTitle>
          <DialogDescription>
            Name one job the agent must do, then say what its secrets and files unlock.
          </DialogDescription>
        </DialogHeader>
        <Field data-invalid={failure === null ? undefined : true}>
          <FieldLabel htmlFor={`${fieldId}-name`}>Name</FieldLabel>
          <Input
            id={`${fieldId}-name`}
            placeholder="PlanetScale admin"
            maxLength={ACCESS_GRANT_NAME_MAX}
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {failure === null ? null : <FieldError>{failure}</FieldError>}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${fieldId}-instruction`}>Instruction</FieldLabel>
          <Textarea
            id={`${fieldId}-instruction`}
            className="min-h-24"
            maxLength={ACCESS_GRANT_INSTRUCTION_MAX}
            placeholder="These two variables give the pscale CLI full access to the app database."
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
          <div className="flex items-center justify-between gap-3">
            <FieldDescription>The agent reads this in your words.</FieldDescription>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {instruction.length}/{ACCESS_GRANT_INSTRUCTION_MAX}
            </span>
          </div>
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled={!canSave} onClick={() => void handleSubmit()}>
            {editing === undefined ? 'Create grant' : 'Save grant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
