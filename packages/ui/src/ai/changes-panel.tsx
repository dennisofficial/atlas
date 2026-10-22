'use client'

import { useState } from 'react'
import { ChevronRightIcon } from 'lucide-react'

import { Button } from '#components/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#components/select'
import { cn } from '#lib/utils'
import { DiffViewer, type DiffLine } from './diff-viewer'
import { EFileChange } from './file-tree'

export { EFileChange }

const MINUS = '−'

export interface ChangedFile {
  path: string
  added: number
  removed: number
  change: EFileChange
  hunk?: string
  lines?: DiffLine[]
}

export interface ChangeScopeOption {
  id: string
  label: string
  detail?: string
}

export interface ChangesPanelProps {
  files: ChangedFile[]
  scopes: ChangeScopeOption[]
  scope: string
  onScopeChange?: (id: string) => void
  expanded?: string[]
  defaultExpanded?: string[]
  onExpandedChange?: (paths: string[]) => void
  onCommit?: () => void
  onReview?: () => void
  onOpenPullRequest?: () => void
  className?: string
}

const CHANGE_MARK: Record<EFileChange, { mark: string; className: string }> = {
  [EFileChange.Added]: { mark: 'A', className: 'text-diff-add-foreground' },
  [EFileChange.Modified]: { mark: 'M', className: 'text-warning' },
  [EFileChange.Deleted]: { mark: 'D', className: 'text-diff-remove-foreground' },
}

export function formatCount(count: number): string {
  if (count < 1000) return `${count}`
  const thousands = count / 1000
  const rounded = thousands < 10 ? Math.round(thousands * 10) / 10 : Math.round(thousands)
  return `${rounded}k`
}

export function totalChanges(files: ChangedFile[]): {
  added: number
  removed: number
} {
  return files.reduce(
    (total, file) => ({
      added: total.added + file.added,
      removed: total.removed + file.removed,
    }),
    { added: 0, removed: 0 },
  )
}

export function splitPath(path: string): { name: string; dir: string } {
  const index = path.lastIndexOf('/')
  if (index === -1) return { name: path, dir: '' }
  return { name: path.slice(index + 1), dir: path.slice(0, index) }
}

function scopeLabel(scope: ChangeScopeOption): string {
  return scope.detail ? `${scope.label} · ${scope.detail}` : scope.label
}

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums">
      <span className="text-diff-add-foreground">+{formatCount(added)}</span>
      <span className="text-diff-remove-foreground">
        {MINUS}
        {formatCount(removed)}
      </span>
    </span>
  )
}

interface FileRowProps {
  file: ChangedFile
  open: boolean
  onToggle: (path: string) => void
}

function FileRow({ file, open, onToggle }: FileRowProps) {
  const { name, dir } = splitPath(file.path)
  const mark = CHANGE_MARK[file.change]
  const handleToggle = () => onToggle(file.path)

  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={handleToggle}
        className={cn(
          'flex w-full min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm outline-none',
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
          <span className="shrink-0 text-foreground">{name}</span>
          {dir ? (
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

function useExpanded({
  expanded,
  defaultExpanded,
  onExpandedChange,
}: Pick<ChangesPanelProps, 'expanded' | 'defaultExpanded' | 'onExpandedChange'>) {
  const [internal, setInternal] = useState<string[]>(defaultExpanded ?? [])
  const current = expanded ?? internal

  const toggle = (path: string) => {
    const next = current.includes(path)
      ? current.filter((entry) => entry !== path)
      : [...current, path]
    setInternal(next)
    onExpandedChange?.(next)
  }

  return { current, toggle }
}

interface ScopeSwitcherProps {
  scopes: ChangeScopeOption[]
  scope: string
  onScopeChange?: (id: string) => void
}

function ScopeSwitcher({ scopes, scope, onScopeChange }: ScopeSwitcherProps) {
  const items = scopes.map((option) => ({
    value: option.id,
    label: scopeLabel(option),
  }))
  const handleValueChange = (value: string | null) => {
    if (value !== null) onScopeChange?.(value)
  }

  return (
    <Select items={items} value={scope} onValueChange={handleValueChange}>
      <SelectTrigger
        size="sm"
        aria-label="Change scope"
        className="w-full min-w-0 border-transparent text-xs text-muted-foreground"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent side="top" alignItemWithTrigger={false} className="min-w-72">
        {scopes.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            <span className="text-foreground">{option.label}</span>
            {option.detail ? <span className="text-muted-foreground">{option.detail}</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ChangesPanel({
  files,
  scopes,
  scope,
  onScopeChange,
  expanded,
  defaultExpanded,
  onExpandedChange,
  onCommit,
  onReview,
  onOpenPullRequest,
  className,
}: ChangesPanelProps) {
  const { current, toggle } = useExpanded({
    expanded,
    defaultExpanded,
    onExpandedChange,
  })
  const totals = totalChanges(files)

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
        ) : (
          <ul className="flex flex-col py-1">
            {files.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                open={current.includes(file.path)}
                onToggle={toggle}
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
