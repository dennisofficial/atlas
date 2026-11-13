'use client'

import { useState, type ReactNode } from 'react'
import { CircleHelpIcon } from 'lucide-react'

import { Button } from '#components/button'
import { Popover, PopoverContent, PopoverTrigger } from '#components/popover'

const HOVER_DELAY_MS = 150

export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const handleOpenChange = (next: boolean) => setOpen(next)
  const handleFocus = () => setOpen(true)
  const handleBlur = () => setOpen(false)
  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        openOnHover
        delay={HOVER_DELAY_MS}
        onFocus={handleFocus}
        onBlur={handleBlur}
        aria-label={`About ${label}`}
        render={<Button variant="ghost" size="icon-xs" />}
      >
        <CircleHelpIcon className="text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" initialFocus={false} className="text-xs">
        {children}
      </PopoverContent>
    </Popover>
  )
}
