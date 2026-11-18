import { ChevronRightIcon, FileIcon, FolderIcon } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import {
  buildChangeTree,
  type ChangeDirNode,
  type ChangeTreeNode,
  EFileChange,
} from '@dltech/atlas-ui/ai/changes-panel'
import { cn } from '@dltech/atlas-ui/lib/utils'

import type { ChangeEntry } from './changes-data'
import { ChangeCounts, ChangeMark, markOf } from './changes-marks'

const ROW_CLASS =
  'flex w-full min-w-0 cursor-pointer items-center gap-2 py-1.5 pr-3 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset'

const GUIDE_CLASS = 'ml-4 flex flex-col border-l pl-1'

export interface ChangesTreeProps {
  entries: ChangeEntry[]
  inline?: boolean
  openFiles?: string[]
  activePath?: string
  onActivate: (path: string) => void
  renderDetail?: (entry: ChangeEntry) => ReactNode
}

interface NodesProps extends ChangesTreeProps {
  nodes: ChangeTreeNode[]
  closed: string[]
  onToggleDir: (path: string) => void
}

interface FileRowProps {
  entry: ChangeEntry
  name: string
  inline?: boolean
  open: boolean
  active: boolean
  onActivate: (path: string) => void
  renderDetail?: (entry: ChangeEntry) => ReactNode
}

function FileRow({
  entry,
  name,
  inline = true,
  open,
  active,
  onActivate,
  renderDetail,
}: FileRowProps) {
  const mark = markOf(entry)
  const deleted = entry.change === EFileChange.Deleted
  const handleActivate = () => onActivate(entry.path)

  return (
    <div className="flex flex-col">
      <button
        type="button"
        data-changed-path={entry.path}
        aria-current={active ? 'true' : undefined}
        aria-expanded={inline ? open : undefined}
        onClick={handleActivate}
        className={cn(ROW_CLASS, active && 'bg-muted/40', open && 'bg-muted/30')}
      >
        {inline ? (
          <ChevronRightIcon
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
        ) : (
          <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        {inline ? <FileIcon className="size-3.5 shrink-0 text-muted-foreground" /> : null}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-foreground',
            deleted && 'text-muted-foreground line-through',
          )}
        >
          {name}
        </span>
        <ChangeCounts added={entry.added} removed={entry.removed} />
        <ChangeMark mark={mark} />
      </button>
      {inline && open && renderDetail ? (
        <div className="ml-4 flex flex-col border-l py-1 pr-2 pl-2">{renderDetail(entry)}</div>
      ) : null}
    </div>
  )
}

function DirRow({
  node,
  closed,
  onToggleDir,
  ...rest
}: Omit<NodesProps, 'nodes'> & { node: ChangeDirNode }) {
  const open = !closed.includes(node.path)
  const handleToggle = () => onToggleDir(node.path)

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        data-changed-folder={node.path}
        onClick={handleToggle}
        className={ROW_CLASS}
      >
        <ChevronRightIcon
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-foreground">{node.name}</span>
        <ChangeCounts added={node.added} removed={node.removed} />
      </button>
      {open ? (
        <div className={GUIDE_CLASS}>
          <TreeNodes {...rest} closed={closed} onToggleDir={onToggleDir} nodes={node.children} />
        </div>
      ) : null}
    </div>
  )
}

function TreeNodes({ nodes, ...rest }: NodesProps) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === 'dir' ? (
          <DirRow key={`dir:${node.path}`} node={node} {...rest} />
        ) : (
          <FileRow
            key={node.file.path}
            entry={node.file}
            name={node.name}
            open={rest.openFiles?.includes(node.file.path) ?? false}
            active={rest.activePath === node.file.path}
            inline={rest.inline}
            onActivate={rest.onActivate}
            renderDetail={rest.renderDetail}
          />
        ),
      )}
    </>
  )
}

export function ChangesTree({ entries, ...rest }: ChangesTreeProps) {
  const nodes = useMemo(() => buildChangeTree(entries), [entries])
  const [closed, setClosed] = useState<string[]>([])
  const handleToggleDir = (path: string) =>
    setClosed((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    )

  return (
    <div className="flex flex-col">
      <TreeNodes
        entries={entries}
        nodes={nodes}
        closed={closed}
        onToggleDir={handleToggleDir}
        {...rest}
      />
    </div>
  )
}

export function DirHeader({ path }: { path: string }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
      <FolderIcon className="size-3.5 shrink-0" />
      <span className="truncate font-mono">{path}</span>
    </div>
  )
}
