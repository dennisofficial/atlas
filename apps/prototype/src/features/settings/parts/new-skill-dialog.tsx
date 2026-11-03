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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'

import { EDITABLE_LAYERS, SKILL_LAYER_LABELS, type ESkillLayer } from '../fixtures/settings-skills'

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/

export function NewSkillDialog({
  onCreate,
}: {
  onCreate: (args: { name: string; layer: ESkillLayer }) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [layer, setLayer] = useState<ESkillLayer | null>(null)
  const valid = NAME_PATTERN.test(name) && layer !== null

  const handleCreate = () => {
    if (!valid || layer === null) return
    onCreate({ name, layer })
    setOpen(false)
    setName('')
    setLayer(null)
  }
  const handleLayerChange = (next: string | null) => {
    if (next !== null) setLayer(next as ESkillLayer)
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
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-skill-name">Name</Label>
            <Input
              id="new-skill-name"
              placeholder="my-skill"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, digits and dashes. The same name in a closer layer shadows this
              one.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label id="new-skill-layer-label" htmlFor="new-skill-layer">
              Layer
            </Label>
            <Select
              items={EDITABLE_LAYERS.map((value) => ({ value, label: SKILL_LAYER_LABELS[value] }))}
              value={layer}
              onValueChange={handleLayerChange}
            >
              <SelectTrigger
                id="new-skill-layer"
                aria-labelledby="new-skill-layer-label"
                className="w-full"
              >
                <SelectValue placeholder="Pick a layer" />
              </SelectTrigger>
              <SelectContent>
                {EDITABLE_LAYERS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {SKILL_LAYER_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
