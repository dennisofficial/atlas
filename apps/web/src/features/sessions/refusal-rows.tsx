'use client'

import { X } from 'lucide-react'

import type { SessionRefusal } from './data/session-refusals'

export function RefusalRows({
  refusals,
  onDismiss,
}: {
  refusals: readonly SessionRefusal[] | undefined
  onDismiss?: (() => void) | undefined
}) {
  if (refusals === undefined || refusals.length === 0) return null
  return (
    <ul aria-label="Refused commands" className="flex flex-col gap-1">
      {refusals.map((refusal) => (
        <li
          key={refusal.inboxId}
          role="alert"
          className="flex items-center justify-between gap-2 px-1 text-xs text-destructive"
        >
          <span className="truncate">{refusal.reason}</span>
          {onDismiss === undefined ? null : (
            <button
              type="button"
              aria-label="Dismiss"
              className="shrink-0 rounded p-0.5 hover:bg-muted"
              onClick={onDismiss}
            >
              <X className="size-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
