'use client'

import { Pencil } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@dltech/atlas-ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'
import { renameSession } from '@/features/sessions/data/rename-session'
import { sessionsApi } from '@/features/sessions/data/sessions-api'
import { messageOf } from '@/features/threads/data/use-send'

export function RenameForm({
  title,
  onSave,
  onClose,
}: {
  title: string | null
  onSave: (name: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(title ?? '')
  const handleKeyDown = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') return onClose()
    if (event.key !== 'Enter' || name.trim().length === 0) return
    event.preventDefault()
    await onSave(name)
  }
  return (
    <Input
      autoFocus
      aria-label="Session name"
      value={name}
      maxLength={200}
      onChange={(event) => setName(event.target.value)}
      onKeyDown={handleKeyDown}
    />
  )
}

export function RenameAction({ sessionId, title }: { sessionId: string; title: string | null }) {
  const [open, setOpen] = useState(false)
  const handleSave = async (name: string) => {
    try {
      await renameSession({ api: sessionsApi, sessionId, name })
      setOpen(false)
    } catch (failure) {
      toast.error(messageOf(failure))
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Rename"
                  className="text-muted-foreground"
                />
              }
            />
          }
        >
          <Pencil />
        </TooltipTrigger>
        <TooltipContent side="top">Rename</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-64">
        <RenameForm title={title} onSave={handleSave} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
