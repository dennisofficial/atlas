'use client'

import { useState } from 'react'
import { PlusIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@dltech/atlas-ui/components/dialog'
import { Input } from '@dltech/atlas-ui/components/input'
import { Label } from '@dltech/atlas-ui/components/label'

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/

export function NewSkillDialog({ onCreate }: { onCreate: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const valid = NAME_PATTERN.test(name)

  const handleCreate = () => {
    if (!valid) return
    onCreate(name)
    setOpen(false)
    setName('')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon data-icon="inline-start" />
        New skill
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New skill</DialogTitle>
          <DialogDescription>
            Creates an empty folder with a bare SKILL.md. No template — you write the skill.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-skill-name">Name</Label>
          <Input
            id="new-skill-name"
            placeholder="my-skill"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Lowercase letters, digits and dashes. A same-named skill in the repository overrides
            this one in sessions.
          </p>
        </div>
        <DialogFooter>
          <Button size="sm" disabled={!valid} onClick={handleCreate}>
            Create skill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
