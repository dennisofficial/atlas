'use client'

import type { SessionRefusal } from './data/session-refusals'

export function RefusalRows({ refusals }: { refusals: readonly SessionRefusal[] | undefined }) {
  if (refusals === undefined || refusals.length === 0) return null
  return (
    <ul aria-label="Refused commands" className="flex flex-col gap-1">
      {refusals.map((refusal) => (
        <li key={refusal.inboxId} role="alert" className="truncate px-1 text-xs text-destructive">
          {refusal.reason}
        </li>
      ))}
    </ul>
  )
}
