'use client'

import { Button } from '@dltech/atlas-ui/components/button'

function ConflictPane({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <pre className="min-h-40 flex-1 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs leading-5 whitespace-pre-wrap">
        {value}
      </pre>
    </div>
  )
}

export function SkillConflict({
  mine,
  theirs,
  onKeepMine,
  onTakeTheirs,
}: {
  mine: string
  theirs: string
  onKeepMine: () => void
  onTakeTheirs: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-lg border border-destructive/40 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-medium">Save failed — this file changed elsewhere</h3>
          <p className="text-sm text-muted-foreground">
            Another thread or browser tab saved a newer version. Pick which one wins.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={onTakeTheirs}>
            Take theirs
          </Button>
          <Button size="sm" onClick={onKeepMine}>
            Keep mine
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        <ConflictPane label="Your version" value={mine} />
        <ConflictPane label="Their version" value={theirs} />
      </div>
    </div>
  )
}
