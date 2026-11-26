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
  fileMountPathProblem,
  MAX_FILE_MOUNT_BYTES,
  personalFileMountPathProblem,
} from '@dltech/atlas-wire/web'

import {
  DEFAULT_MODE_TEXT,
  parseFileMode,
  type TreeEntry,
} from '@/features/project-settings/data/file-mount-helpers'
import { FilePathPicker } from '@/features/project-settings/file-path-picker'

export type AccessFileDraft = { path: string; contents: string; mode: number }

export type EditingFile = { path: string; contents: string; modeText: string }

export function AccessFileDialog({
  personal,
  entries,
  editing,
  defaultOpen = false,
  hideTrigger = false,
  onClosed,
  onSave,
}: {
  personal: boolean
  entries: readonly TreeEntry[]
  editing?: EditingFile
  defaultOpen?: boolean
  hideTrigger?: boolean
  onClosed?: () => void
  onSave: (draft: AccessFileDraft) => Promise<boolean>
}) {
  const fieldId = useId()
  const [open, setOpen] = useState(defaultOpen || editing !== undefined)
  const [path, setPath] = useState(editing?.path ?? '')
  const [contents, setContents] = useState(editing?.contents ?? '')
  const [modeText, setModeText] = useState(editing?.modeText ?? DEFAULT_MODE_TEXT)
  const [saving, setSaving] = useState(false)
  const pathProblem =
    path === ''
      ? null
      : personal
        ? personalFileMountPathProblem(path.trim())
        : fileMountPathProblem(path.trim())
  const mode = parseFileMode(modeText)
  const contentsTooLarge = new TextEncoder().encode(contents).byteLength > MAX_FILE_MOUNT_BYTES
  const canSave =
    path.trim() !== '' && pathProblem === null && mode !== null && !contentsTooLarge && !saving
  const picksFromTree = !personal && editing === undefined

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) return
    setPath('')
    setContents('')
    setModeText(DEFAULT_MODE_TEXT)
    onClosed?.()
  }
  const handleSubmit = async () => {
    if (!canSave || mode === null) return
    setSaving(true)
    const saved = await onSave({ path: path.trim(), contents, mode })
    setSaving(false)
    if (saved) handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {hideTrigger ? null : (
        <DialogTrigger render={<Button variant="outline" size="sm" />}>
          <PlusIcon data-icon="inline-start" />
          Add file
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing === undefined ? 'Add a file' : 'Edit file'}</DialogTitle>
          <DialogDescription>
            {personal
              ? 'Written into every sandbox of every project when it starts. Start the path with ~/ or @/.'
              : 'Written into every sandbox of this project when it starts. Start with ~/ for the home folder.'}
          </DialogDescription>
        </DialogHeader>
        <Field data-invalid={pathProblem !== null || undefined}>
          <FieldLabel htmlFor={`${fieldId}-path`}>Path</FieldLabel>
          {picksFromTree ? (
            <FilePathPicker
              id={`${fieldId}-path`}
              entries={entries}
              path={path}
              invalid={pathProblem !== null}
              onPathChange={setPath}
            />
          ) : (
            <Input
              id={`${fieldId}-path`}
              className="font-mono"
              placeholder="~/.config/gh/hosts.yml"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={pathProblem !== null || undefined}
              disabled={editing !== undefined}
              readOnly={editing !== undefined}
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
          )}
          {pathProblem === null ? (
            <FieldDescription>
              {personal
                ? 'A path inside the home folder, starting with ~/ or @/'
                : 'Relative to the repository root, or starting with ~/'}
            </FieldDescription>
          ) : (
            <FieldError>{pathProblem}</FieldError>
          )}
        </Field>
        <Field data-invalid={contentsTooLarge || undefined}>
          <FieldLabel htmlFor={`${fieldId}-contents`}>Contents</FieldLabel>
          <Textarea
            id={`${fieldId}-contents`}
            className="max-h-[40dvh] min-h-40 font-mono text-xs md:text-xs"
            aria-invalid={contentsTooLarge || undefined}
            spellCheck={false}
            value={contents}
            onChange={(event) => setContents(event.target.value)}
          />
          {contentsTooLarge ? (
            <FieldError>Over 64 KiB</FieldError>
          ) : (
            <FieldDescription>Text only, up to 64 KiB. Encrypted at rest.</FieldDescription>
          )}
        </Field>
        <Field data-invalid={mode === null || undefined}>
          <FieldLabel htmlFor={`${fieldId}-mode`}>Mode</FieldLabel>
          <Input
            id={`${fieldId}-mode`}
            className="w-28 font-mono"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={mode === null || undefined}
            value={modeText}
            onChange={(event) => setModeText(event.target.value)}
          />
          {mode === null ? (
            <FieldError>Use three octal digits, like 0600</FieldError>
          ) : (
            <FieldDescription>Octal permissions. 0600 is owner only.</FieldDescription>
          )}
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled={!canSave} onClick={() => void handleSubmit()}>
            Save file
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
