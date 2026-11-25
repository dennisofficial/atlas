'use client'

import { useId, useState } from 'react'
import { PlusIcon } from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Checkbox } from '@dltech/atlas-ui/components/checkbox'
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'
import { Textarea } from '@dltech/atlas-ui/components/textarea'
import {
  ACCESS_GRANT_INSTRUCTION_MAX,
  ACCESS_GRANT_NAME_MAX,
  type AccessGrant,
} from '@dltech/atlas-wire/web'

import {
  EMemberKind,
  memberOptions,
  toggledMember,
  type MemberOption,
} from './access-grant-helpers'
import type { AccessGrantDraft } from './use-access-grants'

function MemberChecklist({
  kind,
  id,
  legend,
  emptyText,
  options,
  selected,
  onToggle,
}: {
  kind: EMemberKind
  id: string
  legend: string
  emptyText: string
  options: readonly MemberOption[]
  selected: readonly string[]
  onToggle: (name: string) => void
}) {
  return (
    <FieldSet>
      <FieldLegend variant="label" className="mb-0">
        {legend}
      </FieldLegend>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="flex max-h-44 flex-col gap-2 overflow-y-auto rounded-lg border p-3">
          {options.map((option) => {
            const optionId = `${id}-${kind}-${option.name}`
            return (
              <div key={option.name} className="flex min-w-0 items-center gap-2">
                <Checkbox
                  id={optionId}
                  checked={selected.includes(option.name)}
                  onCheckedChange={() => onToggle(option.name)}
                />
                <label
                  htmlFor={optionId}
                  className="min-w-0 flex-1 truncate font-mono text-xs"
                  title={option.name}
                >
                  {option.name}
                </label>
                {option.holder === null ? null : (
                  <Badge variant="outline" className="shrink-0">
                    in {option.holder}
                  </Badge>
                )}
              </div>
            )
          })}
        </div>
      )}
    </FieldSet>
  )
}

export function AccessGrantDialog({
  grants,
  secretNames,
  filePaths,
  editing,
  hideTrigger = false,
  onClosed,
  onSave,
}: {
  grants: readonly AccessGrant[]
  secretNames: readonly string[]
  filePaths?: readonly string[]
  editing?: AccessGrant
  hideTrigger?: boolean
  onClosed?: () => void
  onSave: (draft: AccessGrantDraft) => Promise<void>
}) {
  const fieldId = useId()
  const [open, setOpen] = useState(editing !== undefined)
  const [name, setName] = useState(editing?.name ?? '')
  const [instruction, setInstruction] = useState(editing?.instruction ?? '')
  const [secrets, setSecrets] = useState<readonly string[]>(editing?.secretNames ?? [])
  const [files, setFiles] = useState<readonly string[]>(editing?.filePaths ?? [])
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const otherGrants =
    editing === undefined ? grants : grants.filter((grant) => grant.id !== editing.id)
  const secretOptions = memberOptions({
    grants: otherGrants,
    kind: EMemberKind.Secret,
    names: secretNames,
  })
  const fileOptions = memberOptions({
    grants: otherGrants,
    kind: EMemberKind.File,
    names: filePaths ?? [],
  })
  const canSave = name.trim() !== '' && !saving

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) return
    setName('')
    setInstruction('')
    setSecrets([])
    setFiles([])
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
        secretNames: [...secrets],
        filePaths: [...files],
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
            Group the secrets and files one job needs, and say what they unlock.
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
        <MemberChecklist
          kind={EMemberKind.Secret}
          id={fieldId}
          legend="Secrets"
          emptyText="No secrets in this scope yet. Add them on the Secrets page first."
          options={secretOptions}
          selected={secrets}
          onToggle={(member) => setSecrets((current) => toggledMember(current, member))}
        />
        {filePaths === undefined ? null : (
          <MemberChecklist
            kind={EMemberKind.File}
            id={fieldId}
            legend="Files"
            emptyText="No files mounted in this project yet. Mount them on the Files page first."
            options={fileOptions}
            selected={files}
            onToggle={(member) => setFiles((current) => toggledMember(current, member))}
          />
        )}
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
