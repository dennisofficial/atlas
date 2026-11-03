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

export type SkillFilePrompt =
  | { kind: 'new-file' | 'new-folder' | 'upload'; basePath: string }
  | { kind: 'rename'; path: string; folder: boolean }

function defaultValue(prompt: SkillFilePrompt): string {
  return prompt.kind === 'rename' ? (prompt.path.split('/').at(-1) ?? prompt.path) : ''
}

function titleOf(prompt: SkillFilePrompt): string {
  switch (prompt.kind) {
    case 'new-file':
      return 'New file'
    case 'upload':
      return 'Upload file'
    case 'new-folder':
      return 'New folder'
    case 'rename':
      return `Rename ${prompt.folder ? 'folder' : 'file'}`
  }
}

function resolveTarget({ prompt, value }: { prompt: SkillFilePrompt; value: string }): string {
  const clean = value.trim().replace(/^\/+|\/+$/g, '')
  if (prompt.kind === 'rename') {
    const parent = prompt.path.split('/').slice(0, -1).join('/')
    return parent === '' ? clean : `${parent}/${clean}`
  }
  return prompt.basePath === '' ? clean : `${prompt.basePath}/${clean}`
}

export function SkillFilePromptDialog({
  prompt,
  takenPaths,
  onSubmit,
  onClose,
}: {
  prompt: SkillFilePrompt | null
  takenPaths: string[]
  onSubmit: (args: { prompt: SkillFilePrompt; target: string; file?: File }) => void
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const [pickedFile, setPickedFile] = useState<File | null>(null)
  const folder =
    prompt !== null && (prompt.kind === 'new-folder' || (prompt.kind === 'rename' && prompt.folder))
  const uploading = prompt?.kind === 'upload'
  const label = folder ? 'Folder name' : 'File name'
  const target =
    prompt && pickedFile
      ? resolveTarget({ prompt, value: pickedFile.name })
      : prompt
        ? resolveTarget({ prompt, value })
        : ''
  const invalid =
    prompt === null ||
    (uploading
      ? pickedFile === null || takenPaths.some((path) => path === target)
      : value.trim() === '' ||
        target === '' ||
        target.includes('//') ||
        (prompt.kind !== 'rename' &&
          takenPaths.some((path) => path === target || path.startsWith(`${target}/`))) ||
        (prompt.kind === 'rename' && target === prompt.path))

  const handleSubmit = () => {
    if (invalid || prompt === null) return
    onSubmit({ prompt, target, file: pickedFile ?? undefined })
    setValue('')
    setPickedFile(null)
    onClose()
  }
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setValue('')
      setPickedFile(null)
      onClose()
    }
  }

  return (
    <Dialog open={prompt !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{prompt ? titleOf(prompt) : ''}</DialogTitle>
          <DialogDescription>
            {prompt?.kind === 'rename'
              ? `Renames ${prompt.path}.`
              : `Inside ${prompt?.basePath === '' ? 'the skill root' : prompt?.basePath}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="skill-file-name">{uploading ? 'File' : label}</Label>
          {uploading ? (
            <Input
              id="skill-file-name"
              type="file"
              onChange={(event) => setPickedFile(event.target.files?.[0] ?? null)}
            />
          ) : (
            <Input
              id="skill-file-name"
              placeholder={folder ? 'references' : 'notes.md'}
              value={value || (prompt ? defaultValue(prompt) : '')}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
        </div>
        <DialogFooter>
          <Button size="sm" disabled={invalid} onClick={handleSubmit}>
            {prompt?.kind === 'rename' ? 'Rename' : uploading ? 'Upload' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
