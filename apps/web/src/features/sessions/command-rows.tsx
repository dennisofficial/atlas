'use client'

import type { SessionCommandRow } from '@dltech/atlas-protocol'

import { commandRowLabelOf } from './data/command-rows'

export function CommandRows({ rows }: { rows: readonly SessionCommandRow[] | undefined }) {
  if (rows === undefined || rows.length === 0) return null
  return (
    <ul aria-label="Commands" className="flex flex-col gap-1">
      {rows.map((row) => (
        <li key={row.inboxId} role="status" className="truncate px-1 text-xs text-muted-foreground">
          {commandRowLabelOf(row)}
        </li>
      ))}
    </ul>
  )
}
