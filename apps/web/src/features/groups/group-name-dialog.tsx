'use client'

import { useState } from 'react'

import { groupNameProblem } from '@dltech/atlas-client/settings'
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

export function GroupNameDialog({
  open,
  onOpenChange,
  title,
  description,
  initialName,
  submitLabel,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  initialName: string
  submitLabel: string
  onSubmit: (name: string) => Promise<boolean>
}) {
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const trimmed = name.trim()
  const valid = groupNameProblem({ name }) === null

  const handleOpenChange = (next: boolean) => {
    if (next) setName(initialName)
    onOpenChange(next)
  }

  const handleSubmit = async () => {
    if (!valid || busy) return
    setBusy(true)
    const saved = await onSubmit(trimmed)
    setBusy(false)
    if (saved) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="group-name">Name</Label>
          <Input
            id="group-name"
            placeholder="Comp AI"
            value={name}
            aria-invalid={name !== '' && !valid ? true : undefined}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleSubmit()
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!valid || busy} onClick={() => void handleSubmit()}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
