import { useRef, useState } from 'react'
import { ChevronDownIcon, FolderTreeIcon } from 'lucide-react'
import { splitPath } from '@dltech/atlas-ui/ai/changes-panel'
import { DiffViewer } from '@dltech/atlas-ui/ai/diff-viewer'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { CHANGE_TOTALS, CHANGES } from './changes-data'
import { ChangeCounts, ChangeMark, markOf } from './changes-marks'
import { ChangesTree, DirHeader } from './changes-tree'

export function VariantC() {
  const [showTree, setShowTree] = useState(true)
  const [active, setActive] = useState<string>()
  const blocks = useRef(new Map<string, HTMLElement>())

  const handleToggleTree = () => setShowTree((current) => !current)

  const handleActivate = (path: string) => {
    setActive(path)
    blocks.current.get(path)?.scrollIntoView({ block: 'start' })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-card-foreground">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <ChangeCounts added={CHANGE_TOTALS.added} removed={CHANGE_TOTALS.removed} />
        <span className="text-xs text-muted-foreground tabular-nums">{CHANGES.length} files</span>
        <button
          type="button"
          aria-expanded={showTree}
          onClick={handleToggleTree}
          className="ml-auto flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <FolderTreeIcon className="size-3.5" />
          Files
          <ChevronDownIcon
            className={cn('size-3.5 transition-transform', !showTree && '-rotate-90')}
          />
        </button>
      </header>
      {showTree ? (
        <div className="max-h-56 shrink-0 overflow-auto border-b border-border py-1">
          <ChangesTree
            entries={CHANGES}
            inline={false}
            activePath={active}
            onActivate={handleActivate}
          />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {CHANGES.map((entry, index) => {
          const previous = CHANGES[index - 1]
          const dir = splitPath(entry.path).dir
          const startsFolder = previous === undefined || splitPath(previous.path).dir !== dir

          return (
            <div
              key={entry.path}
              ref={(node) => {
                if (node) blocks.current.set(entry.path, node)
              }}
              className={cn('flex flex-col', active === entry.path && 'bg-muted/20')}
            >
              {startsFolder ? <DirHeader path={dir} /> : null}
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/60 bg-card/95 px-3 py-1.5 backdrop-blur">
                <ChangeMark mark={markOf(entry)} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {entry.from ? (
                    <span className="mr-1.5 text-muted-foreground line-through">{entry.from}</span>
                  ) : null}
                  <span className="text-foreground">{splitPath(entry.path).name}</span>
                </span>
                <ChangeCounts added={entry.added} removed={entry.removed} />
              </div>
              <div className="px-2 py-2">
                {entry.lines ? (
                  <DiffViewer
                    path={entry.path}
                    lines={entry.lines}
                    added={entry.added}
                    removed={entry.removed}
                    hunk={entry.hunk}
                  />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
