import { useState } from 'react'
import { DiffViewer } from '@dltech/atlas-ui/ai/diff-viewer'

import { CHANGE_TOTALS, CHANGES, type ChangeEntry } from './changes-data'
import { ChangeCounts } from './changes-marks'
import { ChangesTree } from './changes-tree'

const DEFAULT_OPEN = 'apps/web/src/app/layout.tsx'

function InlineDiff({ entry }: { entry: ChangeEntry }) {
  if (entry.lines === undefined) {
    return (
      <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
        No diff available for this file.
      </p>
    )
  }

  return (
    <DiffViewer
      path={entry.path}
      lines={entry.lines}
      added={entry.added}
      removed={entry.removed}
      hunk={entry.hunk}
    />
  )
}

export function VariantA() {
  const [open, setOpen] = useState<string[]>([DEFAULT_OPEN])

  const handleActivate = (path: string) =>
    setOpen((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    )

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-card-foreground">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2">
        <ChangeCounts added={CHANGE_TOTALS.added} removed={CHANGE_TOTALS.removed} />
        <span className="text-xs text-muted-foreground tabular-nums">{CHANGES.length} files</span>
        <span className="ml-auto text-xs text-muted-foreground">working tree</span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        <ChangesTree
          entries={CHANGES}
          openFiles={open}
          onActivate={handleActivate}
          renderDetail={(entry) => <InlineDiff entry={entry} />}
        />
      </div>
    </div>
  )
}
