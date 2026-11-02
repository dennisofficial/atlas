'use client'

import { useState } from 'react'

import { Button } from '#components/button'
import { cn } from '#lib/utils'
import { EFileChange } from './file-tree'
import { FileRow } from './internal/changes-file-row'
import { Counts } from './internal/changes-format'
import { LayoutToggle } from './internal/changes-layout-toggle'
import { formatCount, splitPath, totalChanges } from './internal/changes-math'
import { ScopeSwitcher } from './internal/changes-scope-switcher'
import { buildChangeTree } from './internal/changes-tree'
import { ChangesTreeView } from './internal/changes-tree-view'
import type { ChangedFile, ChangeScopeOption, ChangesLayout } from './internal/changes-types'
import { useToggled } from './internal/use-toggled'

export { EFileChange, formatCount, splitPath, totalChanges, buildChangeTree }
export type { ChangedFile, ChangeScopeOption, ChangesLayout }
export type {
  ChangeTreeNode,
  ChangeDirNode,
  ChangeFileNode,
} from './internal/changes-tree'

export interface ChangesPanelProps {
  files: ChangedFile[]
  scopes: ChangeScopeOption[]
  scope: string
  onScopeChange?: (id: string) => void
  layout?: ChangesLayout
  onLayoutChange?: (layout: ChangesLayout) => void
  expanded?: string[]
  defaultExpanded?: string[]
  onExpandedChange?: (paths: string[]) => void
  collapsedFolders?: string[]
  onCollapsedFoldersChange?: (paths: string[]) => void
  onCommit?: () => void
  onReview?: () => void
  onOpenPullRequest?: () => void
  className?: string
}

export function ChangesPanel({
  files,
  scopes,
  scope,
  onScopeChange,
  layout,
  onLayoutChange,
  expanded,
  defaultExpanded,
  onExpandedChange,
  collapsedFolders,
  onCollapsedFoldersChange,
  onCommit,
  onReview,
  onOpenPullRequest,
  className,
}: ChangesPanelProps) {
  const openFiles = useToggled({
    value: expanded,
    defaultValue: defaultExpanded,
    onChange: onExpandedChange,
  })
  const folders = useToggled({
    value: collapsedFolders,
    onChange: onCollapsedFoldersChange,
  })
  const [internalLayout, setInternalLayout] = useState<ChangesLayout>('flat')
  const activeLayout = layout ?? internalLayout
  const totals = totalChanges(files)

  const handleLayoutChange = (next: ChangesLayout) => {
    setInternalLayout(next)
    onLayoutChange?.(next)
  }

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full min-w-0 flex-col bg-card text-card-foreground',
        className,
      )}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <Counts added={totals.added} removed={totals.removed} />
          <span className="truncate text-xs text-muted-foreground tabular-nums">
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <LayoutToggle layout={activeLayout} onLayoutChange={handleLayoutChange} />
          <Button variant="ghost" size="sm" onClick={onCommit}>
            Commit
          </Button>
          <Button variant="outline" size="sm" onClick={onReview}>
            Review
          </Button>
          <Button size="sm" onClick={onOpenPullRequest}>
            Open PR
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {files.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No changes in this scope.
          </p>
        ) : activeLayout === 'tree' ? (
          <div className="py-1">
            <ChangesTreeView
              nodes={buildChangeTree(files)}
              expanded={openFiles.current}
              collapsed={folders.current}
              onToggleFile={openFiles.toggle}
              onToggleFolder={folders.toggle}
            />
          </div>
        ) : (
          <ul className="flex flex-col py-1">
            {files.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                open={openFiles.current.includes(file.path)}
                onToggle={openFiles.toggle}
              />
            ))}
          </ul>
        )}
      </div>
      <div className="shrink-0 border-t border-border p-1.5">
        <ScopeSwitcher scopes={scopes} scope={scope} onScopeChange={onScopeChange} />
      </div>
    </div>
  )
}
