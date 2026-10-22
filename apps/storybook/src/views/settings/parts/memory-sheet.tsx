import { PencilIcon, Trash2Icon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@dltech/atlas-ui/components/sheet'
import { Textarea } from '@dltech/atlas-ui/components/textarea'
import { cn } from '@dltech/atlas-ui/lib/utils'

import {
  EMemoryType,
  formatMemoryDate,
  MEMORY_MAX_BODY_CHARS,
  MEMORY_MAX_DESCRIPTION_CHARS,
  MEMORY_TYPE_OPTIONS,
  type MemoryEntry,
} from '../../../fixtures/settings-memory'
import { Mono } from '../settings-layout'
import { useDraft } from '../use-draft'
import { MemoryTypeBadge } from './memory-row'

export enum EMemorySheetMode {
  View = 'view',
  Edit = 'edit',
}

type MemoryDraft = Pick<MemoryEntry, 'description' | 'type' | 'body'>

function CharCounter({ count, max }: { count: number; max: number }) {
  return (
    <Mono className={cn('self-end text-muted-foreground', count > max && 'text-destructive')}>
      {count.toLocaleString('en-US')} / {max.toLocaleString('en-US')}
    </Mono>
  )
}

function isMemoryType(value: string): value is EMemoryType {
  return Object.values(EMemoryType).some((type) => type === value)
}

function MemoryView({
  entry,
  onEdit,
  onDelete,
}: {
  entry: MemoryEntry
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <>
      <SheetHeader className="gap-2 pr-12">
        <div className="flex items-center gap-2">
          <MemoryTypeBadge type={entry.type} />
          <SheetTitle className="min-w-0 truncate font-mono text-sm">{entry.name}</SheetTitle>
        </div>
        <SheetDescription>{entry.description}</SheetDescription>
        <Mono className="text-muted-foreground">
          rev {entry.revision} · updated {formatMemoryDate(entry.updatedAt)}
        </Mono>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <pre className="rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {entry.body}
        </pre>
      </div>
      <SheetFooter className="flex-row justify-between">
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2Icon data-icon="inline-start" />
          Delete
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
      </SheetFooter>
    </>
  )
}

function MemoryEdit({
  entry,
  onSave,
  onCancel,
  onDelete,
}: {
  entry: MemoryEntry
  onSave: (entry: MemoryEntry) => void
  onCancel: () => void
  onDelete: () => void
}) {
  const draft = useDraft<MemoryDraft>({
    description: entry.description,
    type: entry.type,
    body: entry.body,
  })
  const patch = (next: Partial<MemoryDraft>) => draft.setValue({ ...draft.value, ...next })

  const handleTypeChange = (next: string | null) => {
    if (next !== null && isMemoryType(next)) patch({ type: next })
  }
  const descriptionLength = draft.value.description.length
  const bodyLength = draft.value.body.length
  const descriptionTooLong = descriptionLength > MEMORY_MAX_DESCRIPTION_CHARS
  const bodyTooLong = bodyLength > MEMORY_MAX_BODY_CHARS
  const canSave =
    draft.dirty && draft.value.description.trim().length > 0 && !descriptionTooLong && !bodyTooLong
  const handleSave = () => {
    onSave({
      ...entry,
      ...draft.value,
      revision: entry.revision + 1,
      updatedAt: new Date().toISOString(),
    })
  }

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle>Edit memory</SheetTitle>
        <SheetDescription>
          rev {entry.revision} · updated {formatMemoryDate(entry.updatedAt)}
        </SheetDescription>
      </SheetHeader>
      <FieldGroup className="min-h-0 flex-1 overflow-y-auto px-4">
        <Field>
          <FieldLabel htmlFor="memory-name">Name</FieldLabel>
          <Input id="memory-name" readOnly value={entry.name} className="font-mono text-xs" />
          <FieldDescription>
            The name is the memory's identity; to rename, create a new memory and delete this one.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="memory-description">Description</FieldLabel>
          <Input
            id="memory-description"
            aria-invalid={descriptionTooLong}
            value={draft.value.description}
            onChange={(event) => patch({ description: event.target.value })}
          />
          <CharCounter count={descriptionLength} max={MEMORY_MAX_DESCRIPTION_CHARS} />
        </Field>
        <Field>
          <FieldLabel htmlFor="memory-type">Type</FieldLabel>
          <Select
            items={MEMORY_TYPE_OPTIONS}
            value={draft.value.type}
            onValueChange={handleTypeChange}
          >
            <SelectTrigger id="memory-type" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {MEMORY_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="memory-body">Body</FieldLabel>
          <Textarea
            id="memory-body"
            spellCheck={false}
            aria-invalid={bodyTooLong}
            className="field-sizing-fixed h-64 resize-y font-mono text-xs leading-relaxed"
            value={draft.value.body}
            onChange={(event) => patch({ body: event.target.value })}
          />
          <CharCounter count={bodyLength} max={MEMORY_MAX_BODY_CHARS} />
        </Field>
      </FieldGroup>
      <SheetFooter className="flex-row items-center justify-between">
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2Icon data-icon="inline-start" />
          Delete
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSave} onClick={handleSave}>
            Save
          </Button>
        </div>
      </SheetFooter>
    </>
  )
}

export function MemorySheet({
  entry,
  mode,
  onModeChange,
  onClose,
  onSave,
  onDelete,
}: {
  entry: MemoryEntry | null
  mode: EMemorySheetMode
  onModeChange: (mode: EMemorySheetMode) => void
  onClose: () => void
  onSave: (entry: MemoryEntry) => void
  onDelete: (entry: MemoryEntry) => void
}) {
  const handleOpenChange = (open: boolean) => {
    if (!open) onClose()
  }
  const handleSave = (next: MemoryEntry) => {
    onSave(next)
    onModeChange(EMemorySheetMode.View)
  }
  return (
    <Sheet open={entry !== null} onOpenChange={handleOpenChange}>
      <SheetContent initialFocus={false} className="data-[side=right]:sm:max-w-xl">
        {entry && mode === EMemorySheetMode.Edit ? (
          <MemoryEdit
            key={entry.name}
            entry={entry}
            onSave={handleSave}
            onCancel={() => onModeChange(EMemorySheetMode.View)}
            onDelete={() => onDelete(entry)}
          />
        ) : null}
        {entry && mode === EMemorySheetMode.View ? (
          <MemoryView
            entry={entry}
            onEdit={() => onModeChange(EMemorySheetMode.Edit)}
            onDelete={() => onDelete(entry)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
