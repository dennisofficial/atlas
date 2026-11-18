import { useState } from 'react'
import { splitPath } from '@dltech/atlas-ui/ai/changes-panel'
import { DiffViewer, type DiffMode } from '@dltech/atlas-ui/ai/diff-viewer'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { CHANGE_TOTALS, CHANGES } from './changes-data'
import { ChangeCounts, ChangeMark, EMark, markOf } from './changes-marks'
import { ChangesTree } from './changes-tree'

const DEFAULT_SELECTED = 'apps/web/src/app/layout.tsx'

const MODES: DiffMode[] = ['inline', 'split']

interface ModeButtonProps {
  mode: DiffMode
  active: boolean
  onSelect: (mode: DiffMode) => void
}

function ModeButton({ mode, active, onSelect }: ModeButtonProps) {
  const handleClick = () => onSelect(mode)

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={handleClick}
      className={cn(
        'cursor-pointer rounded px-1.5 py-0.5 capitalize outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {mode}
    </button>
  )
}

export function VariantB() {
  const [selected, setSelected] = useState<string>(DEFAULT_SELECTED)
  const [mode, setMode] = useState<DiffMode>('inline')
  const entry = CHANGES.find((item) => item.path === selected)
  const { name, dir } = splitPath(selected)

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-card-foreground">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2">
        <ChangeCounts added={CHANGE_TOTALS.added} removed={CHANGE_TOTALS.removed} />
        <span className="text-xs text-muted-foreground tabular-nums">{CHANGES.length} files</span>
      </header>
      <div className="max-h-[42%] min-h-0 shrink-0 overflow-auto border-b border-border py-1">
        <ChangesTree
          entries={CHANGES}
          inline={false}
          activePath={selected}
          onActivate={setSelected}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
          <ChangeMark mark={entry ? markOf(entry) : EMark.Modified} />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            <span className="text-muted-foreground">{dir}/</span>
            <span className="text-foreground">{name}</span>
          </span>
          <span className="flex items-center gap-1 font-mono text-xs">
            {MODES.map((item) => (
              <ModeButton key={item} mode={item} active={mode === item} onSelect={setMode} />
            ))}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {entry?.lines ? (
            <DiffViewer
              path={entry.path}
              lines={entry.lines}
              added={entry.added}
              removed={entry.removed}
              hunk={entry.hunk}
              mode={mode}
            />
          ) : (
            <p className="px-1 py-2 text-xs text-muted-foreground">No diff available.</p>
          )}
        </div>
      </div>
    </div>
  )
}
