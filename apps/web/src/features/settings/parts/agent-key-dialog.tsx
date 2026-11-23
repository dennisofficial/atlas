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
  DialogTrigger,
} from '@dltech/atlas-ui/components/dialog'
import { Input } from '@dltech/atlas-ui/components/input'
import { Label } from '@dltech/atlas-ui/components/label'

const NOT_ACCEPTED = 'This key was not accepted. Check it and try again.'

export function KeyDialog({
  providerName,
  placeholder,
  triggerLabel,
  primary = false,
  onSave,
}: {
  providerName: string
  placeholder: string
  triggerLabel: string
  primary?: boolean
  onSave: (key: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState(false)
  const trimmed = value.trim()

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setValue('')
      setFailed(false)
    }
  }
  const handleSave = async () => {
    setChecking(true)
    setFailed(false)
    const saved = await onSave(trimmed)
    setChecking(false)
    if (!saved) {
      setFailed(true)
      return
    }
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant={primary ? 'default' : 'outline'} size="sm" />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {triggerLabel} · {providerName}
          </DialogTitle>
          <DialogDescription>
            Stored encrypted and only sent to {providerName}. It is never shown again after saving.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`key-${providerName}`}>API key</Label>
          <Input
            id={`key-${providerName}`}
            type="password"
            autoComplete="off"
            placeholder={placeholder}
            className="font-mono"
            value={value}
            aria-invalid={failed}
            onChange={(event) => setValue(event.target.value)}
          />
          {failed ? (
            <p role="alert" className="text-xs text-destructive">
              {NOT_ACCEPTED}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={trimmed.length === 0 || checking}
            onClick={() => void handleSave()}
          >
            {checking ? 'Checking…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
