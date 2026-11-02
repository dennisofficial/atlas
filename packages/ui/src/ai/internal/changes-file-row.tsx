import { ChevronRightIcon } from 'lucide-react'

import { cn } from '#lib/utils'
import { DiffViewer } from '../diff-viewer'
import { EFileChange } from '../file-tree'
import { Counts } from './changes-format'
import { splitPath } from './changes-math'
import type { ChangedFile } from './changes-types'

const CHANGE_MARK: Record<EFileChange, { mark: string; className: string }> = {
  [EFileChange.Added]: { mark: 'A', className: 'text-diff-add-foreground' },
  [EFileChange.Modified]: { mark: 'M', className: 'text-warning' },
  [EFileChange.Deleted]: {
    mark: 'D',
    className: 'text-diff-remove-foreground',
  },
}

export const ROW_INDENT_REM = 1

interface FileRowProps {
  file: ChangedFile
  open: boolean
  onToggle: (path: string) => void
  showDir?: boolean
  depth?: number
}

export function FileRow({ file, open, onToggle, showDir = true, depth = 0 }: FileRowProps) {
  const { name, dir } = splitPath(file.path)
  const mark = CHANGE_MARK[file.change]
  const handleToggle = () => onToggle(file.path)

  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        data-changed-path={file.path}
        onClick={handleToggle}
        style={{ paddingLeft: `${0.75 + depth * ROW_INDENT_REM}rem` }}
        className={cn(
          'flex w-full min-w-0 cursor-pointer items-center gap-2 py-1.5 pr-3 text-left text-sm outline-none',
          'hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset',
          open && 'bg-muted/40',
        )}
      >
        <ChevronRightIcon
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="min-w-0 truncate text-foreground">{name}</span>
          {showDir && dir ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">{dir}</span>
          ) : null}
        </span>
        <Counts added={file.added} removed={file.removed} />
        <span
          className={cn('w-3 shrink-0 text-center font-mono text-xs font-semibold', mark.className)}
        >
          {mark.mark}
        </span>
      </button>
      {open ? (
        <div className="px-3 pt-1 pb-2">
          {file.lines ? (
            <DiffViewer
              path={file.path}
              lines={file.lines}
              added={file.added}
              removed={file.removed}
              hunk={file.hunk}
            />
          ) : (
            <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
              No diff available for this file.
            </p>
          )}
        </div>
      ) : null}
    </li>
  )
}
