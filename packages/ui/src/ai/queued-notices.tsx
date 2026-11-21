'use client'

import { BellIcon } from 'lucide-react'

import { cn } from '#lib/utils'

export interface QueuedNotice {
  id: string
  text: string
  failed?: boolean
}

export interface QueuedNoticesProps {
  notices: readonly QueuedNotice[]
  className?: string
}

export function QueuedNotices({ notices, className }: QueuedNoticesProps) {
  if (notices.length === 0) return null

  return (
    <ul
      aria-label="Queued notices"
      className={cn('flex flex-col items-stretch gap-1 px-1', className)}
    >
      {notices.map((notice) => (
        <li
          key={notice.id}
          className={cn(
            'flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground',
            notice.failed && 'text-destructive',
          )}
        >
          <BellIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{notice.text}</span>
        </li>
      ))}
    </ul>
  )
}
