'use client'

import { Button } from '@dltech/atlas-ui/components/button'

export function MemorySelectionBar({
  count,
  onDelete,
  onClear,
}: {
  count: number
  onDelete: () => void
  onClear: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-2">
      <span className="text-sm font-medium tabular-nums">{count} selected</span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  )
}
